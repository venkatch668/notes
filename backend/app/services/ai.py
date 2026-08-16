"""Gemini client — the hosted half of the assistant.

Deliberately thin and dependency-free: `httpx` is already required for JWKS
fetching, and the Generative Language REST API is a small enough surface that a
vendor SDK would add more to install than it removes to write.

Two things this module is strict about:

  * **The key never leaves the server.** Everything the browser can reach is a
    route in `routes.py`; there is no code path that hands the key out.
  * **Tools are read-only.** The model can search notes, list pending tasks and
    read aggregates. It cannot write a block, close a task or edit a page —
    those stay behind explicit user actions, so the notebook always says what
    you wrote.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable

import httpx

from app.config import get_settings
from app.errors import AppError

log = logging.getLogger(__name__)

# How many times the model may call a tool and be handed the result before it
# has to answer. Bounded because each hop is a paid round trip and a model that
# has not converged in four searches is not going to on the fifth.
MAX_TOOL_HOPS = 4


class AiUnavailableError(AppError):
    """No key configured. Distinct from a call that failed, so the client can
    fall back to the local provider rather than surfacing an error."""

    status_code = 503
    code = "ai_unavailable"


class AiUpstreamError(AppError):
    """Gemini is configured but the call did not work. Retrying is reasonable,
    which is the whole reason this is a separate type from the one above."""

    status_code = 502
    code = "ai_upstream"


ToolFn = Callable[[dict[str, Any]], Awaitable[Any]]


# --------------------------------------------------------------- Tool schema

TOOL_DECLARATIONS: list[dict[str, Any]] = [
    {
        "name": "search_notes",
        "description": (
            "Full-text search across the user's own notes. Use this for any "
            "question about what they wrote, worked on, decided or learned. "
            "Prefer several narrow searches over one broad one."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Keywords to search for."},
                "limit": {"type": "integer", "description": "Max hits, default 20."},
            },
            "required": ["query"],
        },
    },
    {
        "name": "list_pending_tasks",
        "description": (
            "Unfinished tasks from before a date, newest deadlines first. Use "
            "for questions about what is outstanding, overdue or slipping."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "before": {"type": "string", "description": "ISO date, YYYY-MM-DD."},
                "limit": {"type": "integer"},
            },
            "required": ["before"],
        },
    },
    {
        "name": "get_weekly_stats",
        "description": (
            "Counted aggregates for one week: tasks done vs total, focus "
            "minutes logged vs estimated, top tags, per-day breakdown. These "
            "numbers are computed from the data — never recompute or estimate "
            "them yourself."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "week_start": {"type": "string", "description": "Monday, YYYY-MM-DD."},
            },
            "required": ["week_start"],
        },
    },
    {
        "name": "get_day_reflection",
        "description": (
            "What the user said they intended for a day, and how they felt it "
            "went. The only record of intent — use it whenever the question is "
            "about focus, drift or whether a day matched the plan."
        ),
        "parameters": {
            "type": "object",
            "properties": {"date": {"type": "string", "description": "ISO date."}},
            "required": ["date"],
        },
    },
    {
        "name": "get_week_summary",
        "description": (
            "A previously generated weekly retro, including the focus goals "
            "set for the following week and how they scored."
        ),
        "parameters": {
            "type": "object",
            "properties": {"week_start": {"type": "string"}},
            "required": ["week_start"],
        },
    },
]


SYSTEM_INSTRUCTION = """
You are the assistant inside a software engineer's work notebook. You answer \
only from what they have actually written, using the tools provided.

Rules:
- Always call a tool before answering a question about their work. Never answer \
from memory of earlier turns alone when a tool could check.
- Numbers come from tools. Never estimate, round differently, or recompute a \
figure the tools returned.
- If the notes do not contain the answer, say so plainly and say what you \
searched for. Do not fill the gap with plausible-sounding detail.
- Be concise and concrete. Short paragraphs or tight bullets, no preamble, no \
restating the question.
- You are read-only. You cannot add, complete or edit tasks and notes; if asked \
to, say what you would change and let them do it.
- When you are pointing at something they wrote, name the date so they can find \
it.
""".strip()


# Thinking tokens are charged against maxOutputTokens, and on a reasoning model
# they routinely dwarf the answer — a 300-token reply came back with 982 tokens
# of thought. Budget for both or the reply is truncated mid-sentence, which for
# a JSON response means it silently fails to parse.
MAX_OUTPUT_TOKENS = 8000


def _payload(
    contents: list[dict[str, Any]],
    *,
    with_tools: bool,
    response_schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config: dict[str, Any] = {"temperature": 0.3, "maxOutputTokens": MAX_OUTPUT_TOKENS}

    # Structured output: the API guarantees a parseable object rather than
    # asking politely for one in the prompt and hoping. Mutually exclusive with
    # tools, which is fine — the calls that want a schema pass no tools.
    if response_schema is not None:
        config["responseMimeType"] = "application/json"
        config["responseSchema"] = response_schema

    body: dict[str, Any] = {
        "contents": contents,
        "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        "generationConfig": config,
    }
    if with_tools:
        body["tools"] = [{"functionDeclarations": TOOL_DECLARATIONS}]
    return body


# Rate limiting and capacity, not mistakes. Worth waiting out; everything else
# will fail again identically no matter how many times it is sent.
RETRY_STATUSES = {429, 503}
MAX_ATTEMPTS = 3


async def _post(client: httpx.AsyncClient, body: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    url = f"{settings.gemini_base_url}/models/{settings.gemini_model}:generateContent"

    for attempt in range(MAX_ATTEMPTS):
        # The key travels as a header, not a query parameter: query strings end
        # up in access logs and proxy traces.
        response = await client.post(
            url,
            json=body,
            headers={"x-goog-api-key": settings.gemini_api_key or ""},
        )

        if response.status_code < 400:
            return response.json()

        # Logged, not echoed: the upstream body can quote the request back,
        # and the request contains the user's notes.
        log.warning("gemini error %s: %s", response.status_code, response.text[:400])

        retryable = response.status_code in RETRY_STATUSES and attempt < MAX_ATTEMPTS - 1
        if not retryable:
            break

        # A free-tier model returns 503 "high demand" often enough that one
        # spike should not cost the user their answer. Backoff is short because
        # someone is waiting on the other end of this request.
        await asyncio.sleep(1.5 * (attempt + 1))

    raise AiUpstreamError("The assistant could not be reached. Try again in a moment.")


def _first_candidate_parts(data: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = data.get("candidates") or []
    if not candidates:
        return []
    return candidates[0].get("content", {}).get("parts") or []


async def generate(
    contents: list[dict[str, Any]],
    tools: dict[str, ToolFn] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """Run one turn to completion, resolving tool calls along the way.

    Returns the answer text plus every tool result gathered, which the caller
    turns into citations — the model is never asked to produce a citation
    itself, because a fabricated block id looks exactly like a real one.
    """
    settings = get_settings()
    if not settings.ai_enabled:
        raise AiUnavailableError("No GEMINI_API_KEY is configured on the server")

    history = list(contents)
    gathered: list[dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=settings.gemini_timeout_s) as client:
        for _ in range(MAX_TOOL_HOPS):
            data = await _post(client, _payload(history, with_tools=bool(tools)))
            parts = _first_candidate_parts(data)

            calls = [p["functionCall"] for p in parts if "functionCall" in p]
            if not calls or not tools:
                text = "".join(p.get("text", "") for p in parts).strip()
                return text, gathered

            # Echo the model's own turn back before the results, or the next
            # request has answers with nothing to attach them to.
            history.append({"role": "model", "parts": parts})

            responses = []
            for call in calls:
                name = call.get("name", "")
                args = call.get("args") or {}
                fn = tools.get(name)
                if fn is None:
                    result: Any = {"error": f"unknown tool {name}"}
                else:
                    try:
                        result = await fn(args)
                        gathered.append({"tool": name, "result": result})
                    except Exception as exc:  # noqa: BLE001
                        # Handed back to the model rather than raised: a failed
                        # search should let it try a different one, not kill
                        # the whole answer.
                        log.warning("tool %s failed: %s", name, exc)
                        result = {"error": str(exc)}
                responses.append(
                    {
                        "functionResponse": {
                            "name": name,
                            # The API requires an object here, so scalars and
                            # lists are wrapped rather than sent bare.
                            "response": {"result": result},
                        }
                    }
                )

            history.append({"role": "user", "parts": responses})

        # Out of hops: ask once more with tools withheld so it must answer with
        # what it already has rather than looping.
        data = await _post(client, _payload(history, with_tools=False))
        text = "".join(p.get("text", "") for p in _first_candidate_parts(data)).strip()
        return text, gathered


def to_contents(messages: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Frontend message list → Gemini `contents`. Gemini calls the assistant
    role "model"."""
    return [
        {
            "role": "model" if m["role"] == "assistant" else "user",
            "parts": [{"text": m["text"]}],
        }
        for m in messages
    ]


async def generate_text(prompt: str) -> str:
    """One-shot generation with no tools — used by the weekly retro, where the
    caller has already assembled every fact the model is allowed to use."""
    text, _ = await generate([{"role": "user", "parts": [{"text": prompt}]}])
    return text


async def generate_json(prompt: str, schema: dict[str, Any]) -> Any:
    """One-shot generation constrained to a schema.

    Returns None if the reply still will not parse, so a caller can fall back
    rather than lose the whole feature to a malformed brace.
    """
    settings = get_settings()
    if not settings.ai_enabled:
        raise AiUnavailableError("No GEMINI_API_KEY is configured on the server")

    contents = [{"role": "user", "parts": [{"text": prompt}]}]
    async with httpx.AsyncClient(timeout=settings.gemini_timeout_s) as client:
        data = await _post(client, _payload(contents, with_tools=False, response_schema=schema))

    candidate = (data.get("candidates") or [{}])[0]
    if candidate.get("finishReason") == "MAX_TOKENS":
        # Worth its own line in the log: the symptom downstream is an
        # unparseable reply, which looks nothing like "the budget was too low".
        log.warning("gemini reply truncated at maxOutputTokens")

    text = "".join(p.get("text", "") for p in _first_candidate_parts(data)).strip()
    return json_block(text)


def json_block(text: str) -> Any:
    """Parse JSON out of a model reply, fenced or bare.

    Returns None rather than raising: a malformed reply should degrade the
    feature that wanted structure, not fail the request.
    """
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned[: cleaned.rindex("```")]
    try:
        return json.loads(cleaned)
    except (ValueError, TypeError):
        return None
