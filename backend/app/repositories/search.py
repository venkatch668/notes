"""Full-text search over blocks.

Postgres does the work. `blocks.search_vector` is a **generated column** kept in
step by the database itself (see the initial migration), indexed with GIN, so
search cost tracks the number of matching rows rather than the size of history
— the scaling property the localStorage implementation could not offer.

Ranking combines three signals:
  * `ts_rank_cd`   — lexical relevance
  * a field weight — headings and tasks matter more than body text
  * recency        — a gentle decay so last week outranks last year on a tie
"""

from __future__ import annotations

import uuid
from datetime import date as Date

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# ts_headline marks matches with these sentinels; the service converts them into
# character offsets so the frontend can render <mark> without parsing HTML.
START_SEL = "\x02"
STOP_SEL = "\x03"

_SEARCH_SQL = f"""
WITH q AS (
    SELECT websearch_to_tsquery('english', :query) AS tsq
)
SELECT
    b.id            AS block_id,
    b.type,
    b.text,
    p.id            AS page_id,
    p.title,
    p.date,
    (
        SELECT h.text
        FROM blocks h
        WHERE h.page_id = b.page_id
          AND h.type = 'HEADING'
          AND h.position < b.position
        ORDER BY h.position DESC
        LIMIT 1
    )               AS heading,
    ts_headline(
        'english', b.text, q.tsq,
        'StartSel="{START_SEL}", StopSel="{STOP_SEL}", MaxWords=32, MinWords=12, ShortWord=2'
    )               AS snippet,
    (
        ts_rank_cd(b.search_vector, q.tsq)
        * CASE b.type WHEN 'HEADING' THEN 3.0 WHEN 'CHECKBOX' THEN 2.0 ELSE 1.0 END
        * (1 + 0.3 * exp(-GREATEST(0, (CURRENT_DATE - COALESCE(p.date, CURRENT_DATE))) / 45.0))
    )               AS score
FROM blocks b
JOIN pages p ON p.id = b.page_id
CROSS JOIN q
WHERE b.user_id = :user_id
  AND (q.tsq IS NULL OR b.search_vector @@ q.tsq)
  AND (CAST(:is_task AS bool)          IS NULL OR (b.task IS NOT NULL) = CAST(:is_task AS bool))
  AND (CAST(:done AS bool)             IS NULL OR COALESCE(b.task ->> 'done', 'false') = CASE WHEN CAST(:done AS bool) THEN 'true' ELSE 'false' END)
  AND (CAST(:priority AS text)         IS NULL OR b.task ->> 'priority' = CAST(:priority AS text))
  AND (CAST(:classification AS text)   IS NULL OR b.classification = CAST(:classification AS text))
  AND (CAST(:tags AS text[])           IS NULL OR b.tags @> CAST(:tags AS text[]))
  AND (CAST(:date_from AS date)        IS NULL OR p.date >= CAST(:date_from AS date))
  AND (CAST(:date_to AS date)          IS NULL OR p.date <= CAST(:date_to AS date))
ORDER BY score DESC, p.date DESC NULLS LAST
LIMIT :limit
"""


async def search_blocks(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    query: str,
    tags: list[str] | None = None,
    classification: str | None = None,
    is_task: bool | None = None,
    done: bool | None = None,
    priority: str | None = None,
    date_from: Date | None = None,
    date_to: Date | None = None,
    limit: int = 100,
) -> list[dict]:
    result = await session.execute(
        text(_SEARCH_SQL),
        {
            "user_id": str(user_id),
            "query": query,
            "tags": tags or None,
            "classification": classification,
            "is_task": is_task,
            "done": done,
            "priority": priority,
            "date_from": date_from,
            "date_to": date_to,
            "limit": min(limit, 200),
        },
    )
    return [dict(row) for row in result.mappings()]


# A filter-only query ("all pending high-priority tasks") has no text to rank,
# so it gets its own statement rather than bending the ranked one with a NULL
# tsquery and a meaningless score.
_FILTER_ONLY_SQL = """
SELECT
    b.id AS block_id, b.type, b.text,
    p.id AS page_id, p.title, p.date,
    NULL::text AS heading,
    left(b.text, 180) AS snippet,
    1.0 AS score
FROM blocks b
JOIN pages p ON p.id = b.page_id
WHERE b.user_id = :user_id
  AND (CAST(:is_task AS bool)        IS NULL OR (b.task IS NOT NULL) = CAST(:is_task AS bool))
  AND (CAST(:done AS bool)           IS NULL OR COALESCE(b.task ->> 'done', 'false') = CASE WHEN CAST(:done AS bool) THEN 'true' ELSE 'false' END)
  AND (CAST(:priority AS text)       IS NULL OR b.task ->> 'priority' = CAST(:priority AS text))
  AND (CAST(:classification AS text) IS NULL OR b.classification = CAST(:classification AS text))
  AND (CAST(:tags AS text[])         IS NULL OR b.tags @> CAST(:tags AS text[]))
  AND (CAST(:date_from AS date)      IS NULL OR p.date >= CAST(:date_from AS date))
  AND (CAST(:date_to AS date)        IS NULL OR p.date <= CAST(:date_to AS date))
  AND btrim(b.text) <> ''
ORDER BY p.date DESC NULLS LAST, b.position
LIMIT :limit
"""


async def filter_blocks(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    tags: list[str] | None = None,
    classification: str | None = None,
    is_task: bool | None = None,
    done: bool | None = None,
    priority: str | None = None,
    date_from: Date | None = None,
    date_to: Date | None = None,
    limit: int = 100,
) -> list[dict]:
    result = await session.execute(
        text(_FILTER_ONLY_SQL),
        {
            "user_id": str(user_id),
            "tags": tags or None,
            "classification": classification,
            "is_task": is_task,
            "done": done,
            "priority": priority,
            "date_from": date_from,
            "date_to": date_to,
            "limit": min(limit, 200),
        },
    )
    return [dict(row) for row in result.mappings()]
