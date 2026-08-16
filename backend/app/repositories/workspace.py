"""Data access for notebooks, sections, pages and blocks.

Every public function takes `user_id` and filters on it. That is the ownership
boundary: if a query here forgets it, the API leaks another user's notes, so it
is deliberately a required first argument on every single call rather than
something callers may pass.
"""

from __future__ import annotations

import uuid
from datetime import date as Date
from datetime import datetime, timezone

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from app.models import Block, Notebook, Page, Section

DEFAULT_SECTION_PALETTE = ["#7719AA", "#0078D4", "#107C10", "#CA5010", "#C239B3", "#008272"]


# ---------------------------------------------------------------- Notebooks


async def list_notebooks(session: AsyncSession, user_id: uuid.UUID) -> list[Notebook]:
    result = await session.scalars(
        select(Notebook)
        .where(Notebook.user_id == user_id)
        .order_by(Notebook.position, Notebook.created_at)
    )
    return list(result)


async def create_notebook(
    session: AsyncSession, user_id: uuid.UUID, name: str, color: str | None = None
) -> Notebook:
    count = await session.scalar(
        select(func.count()).select_from(Notebook).where(Notebook.user_id == user_id)
    )
    position = count or 0
    notebook = Notebook(
        user_id=user_id,
        name=name,
        color=color or DEFAULT_SECTION_PALETTE[position % len(DEFAULT_SECTION_PALETTE)],
        position=position,
    )
    session.add(notebook)
    await session.flush()
    return notebook


# ----------------------------------------------------------------- Sections


async def list_sections(
    session: AsyncSession, user_id: uuid.UUID, notebook_id: uuid.UUID
) -> list[Section]:
    result = await session.scalars(
        select(Section)
        .where(Section.user_id == user_id, Section.notebook_id == notebook_id)
        .order_by(Section.position, Section.created_at)
    )
    return list(result)


async def get_section(
    session: AsyncSession, user_id: uuid.UUID, section_id: uuid.UUID
) -> Section | None:
    return await session.scalar(
        select(Section).where(Section.id == section_id, Section.user_id == user_id)
    )


async def create_section(
    session: AsyncSession,
    user_id: uuid.UUID,
    notebook_id: uuid.UUID,
    name: str,
    color: str | None = None,
) -> Section:
    count = await session.scalar(
        select(func.count())
        .select_from(Section)
        .where(Section.user_id == user_id, Section.notebook_id == notebook_id)
    )
    position = count or 0
    section = Section(
        user_id=user_id,
        notebook_id=notebook_id,
        name=name,
        color=color or DEFAULT_SECTION_PALETTE[position % len(DEFAULT_SECTION_PALETTE)],
        position=position,
    )
    session.add(section)
    await session.flush()
    return section


# -------------------------------------------------------------------- Pages


async def get_page(session: AsyncSession, user_id: uuid.UUID, page_id: uuid.UUID) -> Page | None:
    """Loads a page with its blocks (Page.blocks uses selectin loading)."""
    return await session.scalar(select(Page).where(Page.id == page_id, Page.user_id == user_id))


async def get_daily(
    session: AsyncSession, user_id: uuid.UUID, day: Date
) -> Page | None:
    return await session.scalar(
        select(Page).where(Page.user_id == user_id, Page.date == day, Page.kind == "daily")
    )


async def create_page(
    session: AsyncSession,
    user_id: uuid.UUID,
    section_id: uuid.UUID,
    *,
    title: str,
    kind: str = "free",
    day: Date | None = None,
    page_id: uuid.UUID | None = None,
) -> Page:
    page = Page(user_id=user_id, section_id=section_id, kind=kind, title=title, date=day)
    if page_id is not None:
        page.id = page_id
    session.add(page)
    await session.flush()

    # A brand-new page has no blocks, but the relationship is not *loaded* —
    # serialising it would emit a lazy SELECT outside the async greenlet context
    # and raise MissingGreenlet.
    #
    # `set_committed_value` marks the collection as already-loaded-and-empty.
    # A plain `page.blocks = []` does NOT work here: assigning to a relationship
    # makes SQLAlchemy load the previous contents first to diff them, which is
    # exactly the IO we are trying to avoid.
    set_committed_value(page, "blocks", [])
    return page


async def delete_page(session: AsyncSession, user_id: uuid.UUID, page_id: uuid.UUID) -> int:
    result = await session.execute(
        delete(Page).where(Page.id == page_id, Page.user_id == user_id)
    )
    return result.rowcount or 0


async def touch_page(session: AsyncSession, page: Page) -> None:
    """Bumps `updated_at` even when only child blocks changed.

    Uses a Python timestamp rather than `func.now()` on purpose: a SQL
    expression leaves the attribute expired after flush, so the next read of
    `page.updated_at` would round-trip to the database — again outside the
    greenlet context during response serialisation.
    """
    page.updated_at = datetime.now(tz=timezone.utc)
    await session.flush()


# ------------------------------------------------------------------- Blocks


async def replace_blocks(
    session: AsyncSession, user_id: uuid.UUID, page: Page, blocks: list[dict]
) -> None:
    """Replaces a page's blocks with the client's array.

    Deleting and re-inserting is the honest implementation of a whole-page save:
    it makes reordering and deletion correct by construction, and a note is a
    few dozen rows. The `uq_blocks_page_position` constraint is DEFERRABLE so
    the intermediate states inside this transaction are allowed.
    """
    await session.execute(delete(Block).where(Block.page_id == page.id))
    await session.flush()

    for position, payload in enumerate(blocks):
        session.add(
            Block(
                id=payload["id"],
                user_id=user_id,
                page_id=page.id,
                position=position,
                type=payload.get("type", "TEXT"),
                text=payload.get("text", ""),
                indent=payload.get("indent", 0),
                tags=payload.get("tags") or [],
                classification=payload.get("classification"),
                props=payload.get("props") or {},
                task=payload.get("task"),
            )
        )
    await session.flush()


# ---------------------------------------------------------- Page summaries
#
# Written as SQL rather than ORM traversal on purpose: the list needs per-page
# aggregates (block count, completed count, first non-heading line) and loading
# every block of every page to compute them in Python would be the classic
# N+1 that makes a page list slow once there is real history.

_PAGE_SUMMARY_SQL = """
SELECT
    p.id,
    p.section_id,
    p.kind,
    p.title,
    p.date,
    p.updated_at,
    COALESCE(COUNT(b.id) FILTER (WHERE btrim(b.text) <> ''), 0)            AS filled_blocks,
    COALESCE(COUNT(b.id) FILTER (WHERE b.task ->> 'done' = 'true'), 0)     AS done_tasks,
    (ARRAY_AGG(b.text ORDER BY b.position)
        FILTER (WHERE btrim(b.text) <> '' AND b.type <> 'HEADING'))[1]     AS preview
FROM pages p
LEFT JOIN blocks b ON b.page_id = p.id
WHERE p.user_id = :user_id
  AND (CAST(:section_id AS uuid) IS NULL OR p.section_id = CAST(:section_id AS uuid))
GROUP BY p.id
ORDER BY p.date DESC NULLS LAST, p.updated_at DESC
LIMIT :limit
"""


async def list_page_summaries(
    session: AsyncSession,
    user_id: uuid.UUID,
    section_id: uuid.UUID | None = None,
    limit: int = 500,
) -> list[dict]:
    result = await session.execute(
        text(_PAGE_SUMMARY_SQL),
        {"user_id": str(user_id), "section_id": str(section_id) if section_id else None,
         "limit": limit},
    )
    return [dict(row) for row in result.mappings()]


# ------------------------------------------------------------ Pending tasks

_PENDING_SQL = """
SELECT
    b.id   AS block_id,
    b.type, b.text, b.indent, b.tags, b.classification, b.props, b.task, b.updated_at,
    p.id   AS page_id,
    p.section_id, p.kind, p.title, p.date, p.updated_at AS page_updated_at
FROM blocks b
JOIN pages p ON p.id = b.page_id
WHERE b.user_id = :user_id
  AND b.task IS NOT NULL
  AND COALESCE(b.task ->> 'done', 'false') <> 'true'
  -- A task leaves this list three ways: checked off, forwarded to a later day,
  -- or explicitly dropped. `->>` yields SQL NULL both when the key is absent
  -- (tasks written before day review existed) and when it holds a JSON null,
  -- so one IS NULL test covers legacy and current rows alike.
  AND b.task ->> 'forwardedTo' IS NULL
  AND b.task ->> 'droppedAt' IS NULL
  AND p.date IS NOT NULL
  AND p.date < :before
-- Overdue work first; NULLS LAST keeps undated tasks behind dated ones instead
-- of sorting in front of them.
ORDER BY (b.task ->> 'due') ASC NULLS LAST, p.date DESC, b.position ASC
LIMIT :limit
"""


async def pending_before(
    session: AsyncSession, user_id: uuid.UUID, before: Date, limit: int = 50
) -> list[dict]:
    result = await session.execute(
        text(_PENDING_SQL), {"user_id": str(user_id), "before": before, "limit": limit}
    )
    return [dict(row) for row in result.mappings()]
