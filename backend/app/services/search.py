"""Search service: query parsing, dispatch, and snippet formatting.

Same query language the frontend already understands (`tag:`, `is:`,
`priority:`, `before:`, `after:`), so moving search to the server changes where
it runs, not how it is typed.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from datetime import date as Date

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import search as repo
from app.repositories.search import START_SEL, STOP_SEL


@dataclass
class ParsedQuery:
    terms: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    classification: str | None = None
    is_task: bool | None = None
    done: bool | None = None
    priority: str | None = None
    date_from: Date | None = None
    date_to: Date | None = None

    @property
    def text(self) -> str:
        return " ".join(self.terms).strip()


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_query(raw: str) -> ParsedQuery:
    parsed = ParsedQuery()

    # Quoted phrases pass through untouched: websearch_to_tsquery understands
    # them natively, so we do not need to reimplement phrase matching.
    for token in re.findall(r'"[^"]+"|\S+', raw or ""):
        if token.startswith('"'):
            parsed.terms.append(token)
            continue

        key, _, value = token.partition(":")
        key = key.lower()

        if not value:
            if token.startswith("#"):
                parsed.tags.append(token[1:].lower())
            else:
                parsed.terms.append(token)
            continue

        match key:
            case "tag":
                parsed.tags.append(value.lstrip("#").lower())
            case "is":
                match value.lower():
                    case "task":
                        parsed.is_task = True
                    case "done":
                        parsed.is_task, parsed.done = True, True
                    case "pending":
                        parsed.is_task, parsed.done = True, False
                    case "professional" | "personal":
                        parsed.classification = value.lower()
            case "priority":
                if value.lower() in {"high", "medium", "low"}:
                    parsed.priority = value.lower()
            case "before" if _DATE_RE.match(value):
                parsed.date_to = Date.fromisoformat(value)
            case "after" if _DATE_RE.match(value):
                parsed.date_from = Date.fromisoformat(value)
            case _:
                parsed.terms.append(token)

    return parsed


def _extract_spans(marked: str) -> tuple[str, list[tuple[int, int]]]:
    """Turns ts_headline's sentinels into plain text plus highlight offsets.

    Returning offsets rather than HTML keeps the "never innerHTML user content"
    rule intact all the way from Postgres to React.
    """
    snippet: list[str] = []
    spans: list[tuple[int, int]] = []
    cursor = 0
    start: int | None = None

    for char in marked:
        if char == START_SEL:
            start = cursor
        elif char == STOP_SEL:
            if start is not None:
                spans.append((start, cursor))
                start = None
        else:
            snippet.append(char)
            cursor += 1

    return "".join(snippet), spans


def _to_hit(row: dict) -> dict:
    snippet, spans = _extract_spans(row.get("snippet") or "")
    return {
        "page_id": row["page_id"],
        "block_id": row["block_id"],
        "date": row["date"],
        "title": row["title"],
        "type": row["type"],
        "heading": row.get("heading"),
        "snippet": snippet,
        "spans": spans,
        "score": float(row["score"]),
    }


async def search(
    session: AsyncSession,
    user_id: uuid.UUID,
    raw_query: str,
    *,
    tags: list[str] | None = None,
    classification: str | None = None,
    done: bool | None = None,
    priority: str | None = None,
    limit: int = 100,
) -> list[dict]:
    """Runs a search. Explicit filter arguments (the UI's chips) merge with any
    filters embedded in the query string."""
    parsed = parse_query(raw_query)

    merged_tags = sorted({*parsed.tags, *(tags or [])})
    filters = {
        "tags": merged_tags or None,
        "classification": classification or parsed.classification,
        "is_task": parsed.is_task,
        "done": done if done is not None else parsed.done,
        "priority": priority or parsed.priority,
        "date_from": parsed.date_from,
        "date_to": parsed.date_to,
        "limit": limit,
    }
    if filters["done"] is not None:
        filters["is_task"] = True

    if parsed.text:
        rows = await repo.search_blocks(session, user_id, query=parsed.text, **filters)
    else:
        # No search terms — this is a filter query ("everything still pending"),
        # which is a listing, not a ranking problem.
        rows = await repo.filter_blocks(session, user_id, **filters)

    return [_to_hit(row) for row in rows]
