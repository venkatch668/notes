"""The complete surface the model may touch.

Everything Gemini can reach goes through this file. That containment is the
point: the model never sees the session, never sees SQL, and never sees a
function that writes. Adding a capability here is a deliberate act, which is
exactly the property you want when the thing on the other end is non-
deterministic and reading someone's private notebook.

Results are size-capped before they leave, so a broad search cannot push an
unbounded slice of the notebook into a prompt.
"""

from __future__ import annotations

import uuid
from datetime import date as Date
from datetime import timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import analytics as analytics_repo
from app.repositories import retro as retro_repo
from app.services import search as search_service
from app.services import workspace as workspace_service

MAX_HITS = 25
MAX_PENDING = 30


def _as_date(raw: Any, fallback: Date | None = None) -> Date:
    """Dates arrive as model-authored strings and are routinely malformed.

    A bad date must degrade to something sensible rather than 500 the request:
    the model gets an answer it can reason about and try again with.
    """
    if isinstance(raw, str):
        try:
            return Date.fromisoformat(raw.strip()[:10])
        except ValueError:
            pass
    return fallback or Date.today()


def build(session: AsyncSession, user_id: uuid.UUID) -> dict[str, Any]:
    """Bind the read-only tools to one user's data for one request."""

    async def search_notes(args: dict) -> Any:
        limit = min(int(args.get("limit") or MAX_HITS), MAX_HITS)
        hits = await search_service.search(
            session, user_id, str(args.get("query") or ""), limit=limit
        )
        return [
            {
                "date": str(h["date"]) if h.get("date") else None,
                "pageId": str(h["page_id"]),
                "blockId": str(h["block_id"]),
                "title": h.get("title"),
                "heading": h.get("heading"),
                "text": h.get("snippet"),
            }
            for h in hits[:limit]
        ]

    async def list_pending_tasks(args: dict) -> Any:
        before = _as_date(args.get("before"), Date.today() + timedelta(days=1))
        limit = min(int(args.get("limit") or MAX_PENDING), MAX_PENDING)
        rows = await workspace_service.pending_before(session, user_id, before, limit)
        return [
            {
                "date": str(r["page"]["date"]) if r["page"].get("date") else None,
                "pageId": str(r["page"]["id"]),
                "blockId": str(r["block"]["id"]),
                "text": r["block"].get("text"),
                "task": r["block"].get("task"),
            }
            for r in rows
        ]

    async def get_weekly_stats(args: dict) -> Any:
        start = _as_date(args.get("week_start"))
        end = start + timedelta(days=6)
        stats = await analytics_repo.weekly_stats(session, user_id, start, end)
        focus = await analytics_repo.focus_by_tag(session, user_id, start, end)
        return {
            "weekStart": str(start),
            "weekEnd": str(end),
            **{k: v for k, v in stats.items() if k != "per_day"},
            "focusByTag": focus,
        }

    async def get_day_reflection(args: dict) -> Any:
        day = _as_date(args.get("date"))
        row = await retro_repo.get_reflection(session, user_id, day)
        if row is None:
            return {"date": str(day), "found": False}
        return {
            "date": str(row.date),
            "found": True,
            "intent": row.intent,
            "wentWell": row.went_well,
            "blockers": row.blockers,
            "focusMinutes": row.focus_minutes,
            "tasksDone": row.tasks_done,
            "tasksOpen": row.tasks_open,
        }

    async def get_week_summary(args: dict) -> Any:
        start = _as_date(args.get("week_start"))
        row = await retro_repo.get_week_summary(session, user_id, start)
        if row is None:
            return {"weekStart": str(start), "found": False}
        return {
            "weekStart": str(row.week_start),
            "found": True,
            "narrative": row.narrative,
            "highlights": row.highlights,
            "dropped": row.dropped,
            "focusByTag": row.focus_by_tag,
            "goals": row.goals,
            "goalScores": row.goal_scores,
        }

    return {
        "search_notes": search_notes,
        "list_pending_tasks": list_pending_tasks,
        "get_weekly_stats": get_weekly_stats,
        "get_day_reflection": get_day_reflection,
        "get_week_summary": get_week_summary,
    }


def citations_from(gathered: list[dict]) -> list[dict]:
    """Turn tool results into citations.

    Built from what the tools returned rather than from anything the model
    wrote: a fabricated block id looks exactly like a real one until someone
    clicks it and lands nowhere, and that failure destroys trust in every other
    answer too.
    """
    out: list[dict] = []
    seen: set[str] = set()

    for entry in gathered:
        result = entry.get("result")
        if not isinstance(result, list):
            continue
        for item in result:
            if not isinstance(item, dict):
                continue
            block_id = item.get("blockId")
            page_id = item.get("pageId")
            if not block_id or not page_id or block_id in seen:
                continue
            seen.add(block_id)
            out.append(
                {
                    "date": item.get("date"),
                    "page_id": page_id,
                    "block_id": block_id,
                    "label": item.get("date") or item.get("title") or "note",
                }
            )

    # Six is what the panel can show without the answer turning into a
    # bibliography.
    return out[:6]
