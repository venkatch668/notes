"""Workspace service: notebooks, sections, pages, blocks, carry-forward.

Rules live here. Repositories fetch and store; routes translate HTTP. This
layer is the only one that knows things like "a new user gets a Daily Log
section" or "saving a stale page is a conflict".
"""

from __future__ import annotations

import uuid
from datetime import date as Date
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ConflictError, NotFoundError
from app.models import Page
from app.repositories import workspace as repo
from app.schemas import PageSave

# A first-time user should land in a working notebook, not an empty shell —
# the product promise is "open and write", which cannot survive a setup wizard.
DEFAULT_NOTEBOOK = "Work Notebook"
DEFAULT_SECTIONS = [
    ("Daily Log", "#7719AA"),
    ("Meetings", "#0078D4"),
    ("Ideas", "#107C10"),
]
DAILY_SECTION_NAME = "Daily Log"


async def ensure_workspace(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Idempotently creates the default notebook and sections for a new user."""
    notebooks = await repo.list_notebooks(session, user_id)
    if notebooks:
        return

    notebook = await repo.create_notebook(session, user_id, DEFAULT_NOTEBOOK, "#7719AA")
    for name, color in DEFAULT_SECTIONS:
        await repo.create_section(session, user_id, notebook.id, name, color)


async def daily_section_id(session: AsyncSession, user_id: uuid.UUID) -> uuid.UUID:
    """The section daily notes belong to, creating the default set if needed."""
    await ensure_workspace(session, user_id)

    notebooks = await repo.list_notebooks(session, user_id)
    for notebook in notebooks:
        sections = await repo.list_sections(session, user_id, notebook.id)
        for section in sections:
            if section.name == DAILY_SECTION_NAME:
                return section.id

    # A user who renamed or deleted the section still needs somewhere to write.
    notebook = notebooks[0]
    section = await repo.create_section(session, user_id, notebook.id, DAILY_SECTION_NAME)
    return section.id


async def get_or_create_daily(
    session: AsyncSession, user_id: uuid.UUID, day: Date, page_id: uuid.UUID | None = None
) -> Page:
    """One note per date (FR-1.1), created lazily on first access.

    `page_id` lets a client that already created this day offline keep its id,
    so queued edits still reference a page that exists. An existing page always
    wins — the database's partial unique index is the authority on "one per
    day", not the client's optimism.
    """
    page = await repo.get_daily(session, user_id, day)
    if page:
        return page

    section_id = await daily_section_id(session, user_id)
    return await repo.create_page(
        session, user_id, section_id, title=day.isoformat(), kind="daily", day=day,
        page_id=page_id,
    )


async def get_page(session: AsyncSession, user_id: uuid.UUID, page_id: uuid.UUID) -> Page:
    page = await repo.get_page(session, user_id, page_id)
    if not page:
        raise NotFoundError("Page not found")
    return page


async def save_page(
    session: AsyncSession, user_id: uuid.UUID, page_id: uuid.UUID, payload: PageSave
) -> Page:
    """Whole-page save with optimistic concurrency.

    The client sends the `updated_at` its edit was based on. If the server has
    moved on since — another device saved, or an offline queue replayed late —
    we refuse rather than overwrite, and the caller receives the server's copy
    to merge. Silent last-write-wins is how notes disappear.
    """
    page = await repo.get_page(session, user_id, page_id)
    if not page:
        raise NotFoundError("Page not found")

    if payload.base_updated_at is not None:
        server_ts = page.updated_at
        client_ts = payload.base_updated_at
        if client_ts.tzinfo is None:
            client_ts = client_ts.replace(tzinfo=timezone.utc)
        # Whole seconds: Postgres and JS disagree below microsecond precision,
        # and a false conflict is as user-hostile as a lost write.
        if (server_ts - client_ts).total_seconds() > 1:
            raise ConflictError(
                "This page changed on the server since your copy was loaded",
                details={"serverUpdatedAt": server_ts.isoformat()},
            )

    if payload.title is not None and page.kind == "free":
        page.title = payload.title

    # by_alias=True stores camelCase keys ("estimateMin", "carriedFrom"), which
    # is what the analytics and search SQL reads and what the frontend expects
    # back. Dumping snake_case here would silently break both.
    blocks = [block.model_dump(by_alias=True) for block in payload.blocks]
    await repo.replace_blocks(session, user_id, page, blocks)
    await repo.touch_page(session, page)

    await session.refresh(page, ["blocks"])
    return page


async def create_page(
    session: AsyncSession,
    user_id: uuid.UUID,
    section_id: uuid.UUID,
    title: str,
    page_id: uuid.UUID | None = None,
) -> Page:
    section = await repo.get_section(session, user_id, section_id)
    if not section:
        raise NotFoundError("Section not found")

    if page_id is not None:
        existing = await repo.get_page(session, user_id, page_id)
        if existing:
            return existing  # replayed from an offline queue; not an error

    return await repo.create_page(
        session, user_id, section_id, title=title, kind="free", page_id=page_id
    )


async def delete_page(session: AsyncSession, user_id: uuid.UUID, page_id: uuid.UUID) -> None:
    if not await repo.delete_page(session, user_id, page_id):
        raise NotFoundError("Page not found")


# --------------------------------------------------------------- Summaries


def _activity(filled_blocks: int, done_tasks: int) -> int:
    """0–4 dots, matching the frontend's calendar indicator."""
    return max(0, min(4, round(filled_blocks / 4 + done_tasks / 2)))


def to_summary(row: dict) -> dict:
    preview = (row.get("preview") or "").strip()
    return {
        "id": row["id"],
        "section_id": row["section_id"],
        "kind": row["kind"],
        "title": row["title"],
        "date": row["date"],
        "updated_at": row["updated_at"],
        "preview": preview[:90],
        "activity": _activity(int(row["filled_blocks"]), int(row["done_tasks"])),
    }


async def list_page_summaries(
    session: AsyncSession, user_id: uuid.UUID, section_id: uuid.UUID | None
) -> list[dict]:
    rows = await repo.list_page_summaries(session, user_id, section_id)
    return [to_summary(row) for row in rows]


# ---------------------------------------------------------- Carry-forward


async def pending_before(
    session: AsyncSession, user_id: uuid.UUID, before: Date, limit: int = 20
) -> list[dict]:
    """Unfinished tasks from earlier days, for today's carry-forward strip."""
    rows = await repo.pending_before(session, user_id, before, limit)

    return [
        {
            "page": {
                "id": row["page_id"],
                "section_id": row["section_id"],
                "kind": row["kind"],
                "title": row["title"],
                "date": row["date"],
                "updated_at": row["page_updated_at"],
                "preview": "",
                "activity": 0,
            },
            "block": {
                "id": row["block_id"],
                "type": row["type"],
                "text": row["text"],
                "indent": row["indent"],
                "tags": row["tags"] or [],
                "classification": row["classification"],
                "props": row["props"] or {},
                "task": row["task"],
                "updated_at": row["updated_at"],
            },
        }
        for row in rows
    ]


def utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)
