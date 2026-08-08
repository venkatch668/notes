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
