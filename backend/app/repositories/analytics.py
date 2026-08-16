"""Weekly aggregates.

Computed by the database in two passes rather than by loading a week of notes
into Python. Insights stay honest arithmetic over the user's own data — no
model is involved in producing these numbers (design.md §7).
"""

from __future__ import annotations

import uuid
from datetime import date as Date

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_TOTALS_SQL = """
SELECT
    COUNT(*) FILTER (WHERE b.task IS NOT NULL)                                     AS tasks_total,
    COUNT(*) FILTER (WHERE b.task ->> 'done' = 'true')                             AS tasks_done,
    COUNT(*) FILTER (WHERE b.task ->> 'carriedFrom' IS NOT NULL)                   AS carried_forward,
    COUNT(*) FILTER (WHERE b.task ->> 'done' = 'true'
                       AND b.task ->> 'priority' = 'high')                         AS high_priority_done,
    COUNT(*) FILTER (WHERE b.classification = 'professional')                      AS professional,
    COUNT(*) FILTER (WHERE b.classification = 'personal')                          AS personal,
    COALESCE(SUM((b.task ->> 'estimateMin')::numeric), 0)                          AS estimate_min,
    COALESCE(SUM((b.task ->> 'actualMin')::numeric), 0)                            AS actual_min
FROM blocks b
JOIN pages p ON p.id = b.page_id
WHERE b.user_id = :user_id
  AND p.date BETWEEN :week_start AND :week_end
"""

_PER_DAY_SQL = """
SELECT
    d.day::date                                                       AS date,
    COUNT(b.id) FILTER (WHERE b.task ->> 'done' = 'true')             AS done,
    COUNT(b.id) FILTER (WHERE b.task IS NOT NULL)                     AS total
FROM generate_series(CAST(:week_start AS date), CAST(:week_end AS date), '1 day') AS d(day)
LEFT JOIN pages p  ON p.date = d.day::date AND p.user_id = :user_id
LEFT JOIN blocks b ON b.page_id = p.id
GROUP BY d.day
ORDER BY d.day
"""

_TOP_TAGS_SQL = """
SELECT tag, COUNT(*) AS count
FROM blocks b
JOIN pages p ON p.id = b.page_id
CROSS JOIN LATERAL unnest(b.tags) AS tag
WHERE b.user_id = :user_id
  AND p.date BETWEEN :week_start AND :week_end
GROUP BY tag
ORDER BY count DESC, tag
LIMIT 6
"""


_FOCUS_BY_TAG_SQL = """
SELECT tag, COALESCE(SUM((b.task ->> 'actualMin')::numeric), 0)::int AS minutes
FROM blocks b
JOIN pages p ON p.id = b.page_id
CROSS JOIN LATERAL unnest(b.tags) AS tag
WHERE b.user_id = :user_id
  AND p.date BETWEEN :week_start AND :week_end
  AND b.task ->> 'actualMin' IS NOT NULL
GROUP BY tag
HAVING SUM((b.task ->> 'actualMin')::numeric) > 0
ORDER BY minutes DESC
"""

_DROPPED_SQL = """
SELECT b.text, p.date
FROM blocks b
JOIN pages p ON p.id = b.page_id
WHERE b.user_id = :user_id
  AND p.date BETWEEN :week_start AND :week_end
  AND b.task ->> 'droppedAt' IS NOT NULL
ORDER BY p.date
LIMIT 20
"""

_DONE_SQL = """
SELECT b.text, p.date
FROM blocks b
JOIN pages p ON p.id = b.page_id
WHERE b.user_id = :user_id
  AND p.date BETWEEN :week_start AND :week_end
  AND b.task ->> 'done' = 'true'
ORDER BY (b.task ->> 'priority' = 'high') DESC, p.date
LIMIT 40
"""

_STUCK_SQL = """
SELECT b.text, p.date, COALESCE((b.task ->> 'carryCount')::int, 0) AS hops
FROM blocks b
JOIN pages p ON p.id = b.page_id
WHERE b.user_id = :user_id
  AND p.date BETWEEN :week_start AND :week_end
  AND COALESCE(b.task ->> 'done', 'false') <> 'true'
  AND b.task ->> 'droppedAt' IS NULL
  AND COALESCE((b.task ->> 'carryCount')::int, 0) >= 2
ORDER BY hops DESC
LIMIT 15
"""


async def focus_by_tag(
    session: AsyncSession, user_id: uuid.UUID, week_start: Date, week_end: Date
) -> dict[str, int]:
    """Logged minutes per tag for the week.

    The denominator for every "where did the week actually go" question, and
    what the focus goals are scored against. A task with two tags contributes
    its minutes to both, so these sum to more than the week's total — the
    question being answered is "how much work touched #oncall", not "how much
    was exclusively #oncall".
    """
    rows = await session.execute(
        text(_FOCUS_BY_TAG_SQL),
        {"user_id": str(user_id), "week_start": week_start, "week_end": week_end},
    )
    return {r["tag"]: int(r["minutes"]) for r in rows.mappings()}


async def week_material(
    session: AsyncSession, user_id: uuid.UUID, week_start: Date, week_end: Date
) -> dict:
    """The raw week, for the retro to summarise.

    Everything here is fact from the database. The model is handed these and
    asked only to write prose around them — it is never the source of a number
    or of a task that the user did not write.
    """
    params = {"user_id": str(user_id), "week_start": week_start, "week_end": week_end}

    async def rows(sql: str) -> list[dict]:
        return [dict(r) for r in (await session.execute(text(sql), params)).mappings()]

    return {
        "done": await rows(_DONE_SQL),
        "dropped": await rows(_DROPPED_SQL),
        "stuck": await rows(_STUCK_SQL),
    }


async def weekly_stats(
    session: AsyncSession, user_id: uuid.UUID, week_start: Date, week_end: Date
) -> dict:
    params = {"user_id": str(user_id), "week_start": week_start, "week_end": week_end}

    totals = (await session.execute(text(_TOTALS_SQL), params)).mappings().one()
    per_day = [dict(r) for r in (await session.execute(text(_PER_DAY_SQL), params)).mappings()]
    top_tags = [dict(r) for r in (await session.execute(text(_TOP_TAGS_SQL), params)).mappings()]

    best = max(per_day, key=lambda d: d["done"], default=None)

    return {
        **{k: int(v) for k, v in totals.items()},
        "per_day": per_day,
        "top_tags": top_tags,
        "best_day": best["date"] if best and best["done"] > 0 else None,
    }
