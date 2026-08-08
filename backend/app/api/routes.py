"""HTTP routes.

Thin by design: parse the request, call one service, shape the response. Any
`if` statement expressing a product rule belongs in a service, not here.

The route surface deliberately mirrors the frontend's `WorkspaceApi` interface
one-for-one, so `httpApi.ts` is a direct transcription rather than an
adaptation layer.
"""

from __future__ import annotations

import uuid
from datetime import date as Date

from fastapi import APIRouter, Query, status

from app.api.deps import CurrentUserDep, DbSession
from app.repositories import analytics as analytics_repo
from app.repositories import workspace as repo
from app.schemas import (
    DailyClaim,
    NotebookCreate,
    NotebookOut,
    PageCreate,
    PageOut,
    PageSave,
    PageSummaryOut,
    PendingTaskOut,
    SearchHitOut,
    SectionCreate,
    SectionOut,
    WeeklyStatsOut,
)
from app.services import search as search_service
from app.services import workspace as service

router = APIRouter()


# ---------------------------------------------------------------- Notebooks


@router.get("/notebooks", response_model=list[NotebookOut])
async def list_notebooks(session: DbSession, user: CurrentUserDep):
    # First call after signup bootstraps the default notebook, so the client
    # never has to special-case an empty account.
    await service.ensure_workspace(session, user.id)
    return await repo.list_notebooks(session, user.id)


@router.post("/notebooks", response_model=NotebookOut, status_code=status.HTTP_201_CREATED)
async def create_notebook(payload: NotebookCreate, session: DbSession, user: CurrentUserDep):
    return await repo.create_notebook(session, user.id, payload.name, payload.color)


# ----------------------------------------------------------------- Sections


@router.get("/notebooks/{notebook_id}/sections", response_model=list[SectionOut])
async def list_sections(notebook_id: uuid.UUID, session: DbSession, user: CurrentUserDep):
    return await repo.list_sections(session, user.id, notebook_id)


@router.post("/sections", response_model=SectionOut, status_code=status.HTTP_201_CREATED)
async def create_section(payload: SectionCreate, session: DbSession, user: CurrentUserDep):
    return await repo.create_section(
        session, user.id, payload.notebook_id, payload.name, payload.color
    )


# -------------------------------------------------------------------- Pages


@router.get("/sections/{section_id}/pages", response_model=list[PageSummaryOut])
async def list_pages(section_id: uuid.UUID, session: DbSession, user: CurrentUserDep):
    return await service.list_page_summaries(session, user.id, section_id)


@router.get("/pages", response_model=list[PageSummaryOut])
async def list_all_pages(session: DbSession, user: CurrentUserDep):
    """Every page, newest first — powers the calendar's activity dots."""
    return await service.list_page_summaries(session, user.id, None)


@router.get("/daily/{day}", response_model=PageOut)
async def get_or_create_daily(day: Date, session: DbSession, user: CurrentUserDep):
    """The one note for a date, created on first visit (FR-1.1)."""
    return await service.get_or_create_daily(session, user.id, day)


@router.get("/pages/{page_id}", response_model=PageOut)
async def get_page(page_id: uuid.UUID, session: DbSession, user: CurrentUserDep):
    return await service.get_page(session, user.id, page_id)


@router.post("/pages", response_model=PageOut, status_code=status.HTTP_201_CREATED)
async def create_page(payload: PageCreate, session: DbSession, user: CurrentUserDep):
    return await service.create_page(
        session, user.id, payload.section_id, payload.title, payload.id
    )


@router.put("/daily/{day}", response_model=PageOut)
async def claim_daily(
    day: Date, payload: DailyClaim, session: DbSession, user: CurrentUserDep
):
    """Get-or-create a daily note, optionally keeping a client-generated id.

    Idempotent: replaying this from an offline queue returns the existing page
    rather than failing.
    """
    return await service.get_or_create_daily(session, user.id, day, payload.id)


@router.put("/pages/{page_id}", response_model=PageOut)
async def save_page(
    page_id: uuid.UUID, payload: PageSave, session: DbSession, user: CurrentUserDep
):
    """Saves a whole page. Returns 409 if the server copy is newer."""
    return await service.save_page(session, user.id, page_id, payload)


@router.delete("/pages/{page_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_page(page_id: uuid.UUID, session: DbSession, user: CurrentUserDep):
    await service.delete_page(session, user.id, page_id)


# ------------------------------------------------------------------- Search


@router.get("/search", response_model=list[SearchHitOut])
async def search(
    session: DbSession,
    user: CurrentUserDep,
    q: str = Query(default="", description="Query text, may include tag:/is:/priority: filters"),
    tag: list[str] | None = Query(default=None),
    classification: str | None = Query(default=None),
    done: bool | None = Query(default=None),
    priority: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
):
    return await search_service.search(
        session,
        user.id,
        q,
        tags=tag,
        classification=classification,
        done=done,
        priority=priority,
        limit=limit,
    )


# -------------------------------------------------------------------- Tasks


@router.get("/tasks/pending", response_model=list[PendingTaskOut])
async def pending_tasks(
    session: DbSession,
    user: CurrentUserDep,
    before: Date,
    limit: int = Query(default=20, ge=1, le=200),
):
    """Unfinished tasks from before `before` — the carry-forward candidates."""
    return await service.pending_before(session, user.id, before, limit)


# ---------------------------------------------------------------- Analytics


@router.get("/stats/weekly", response_model=WeeklyStatsOut)
async def weekly_stats(session: DbSession, user: CurrentUserDep, week_start: Date):
    from datetime import timedelta

    week_end = week_start + timedelta(days=6)
    stats = await analytics_repo.weekly_stats(session, user.id, week_start, week_end)
    return {"from": week_start, "to": week_end, **stats}
