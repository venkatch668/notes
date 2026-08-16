"""Pydantic DTOs — the wire contract.

These mirror `frontend/src/types/models.ts` field for field, in camelCase, so
the frontend's `httpApi.ts` can consume responses with no translation layer.
`alias_generator` handles the snake_case ↔ camelCase boundary in one place
instead of at every field.
"""

from __future__ import annotations

import uuid
from datetime import date as Date
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def to_camel(s: str) -> str:
    head, *rest = s.split("_")
    return head + "".join(word.capitalize() for word in rest)


class Schema(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,  # accept snake_case too, so curl stays pleasant
        from_attributes=True,
    )


BlockType = Literal[
    "TEXT", "HEADING", "CHECKBOX", "BULLET", "NUMBER", "TABLE", "CODE", "IMAGE", "DIVIDER"
]
Classification = Literal["professional", "personal"] | None
Priority = Literal["high", "medium", "low"] | None
PageKind = Literal["daily", "free"]


# --------------------------------------------------------------------- Task


class Task(Schema):
    done: bool = False
    priority: Priority = None
    due: Date | None = None
    estimate_min: int | None = None
    actual_min: int | None = None
    completed_at: int | None = None  # epoch ms, matching the frontend
    reminder_at: str | None = None
    carried_from: Date | None = None
    # Day-review bookkeeping. These MUST be declared here: Pydantic drops
    # undeclared fields, so a task saved without them would come back from the
    # server stripped of its carry state and be offered again every morning.
    forwarded_to: uuid.UUID | None = None
    carry_count: int = 0
    dropped_at: int | None = None  # epoch ms
    origin_id: uuid.UUID | None = None


# -------------------------------------------------------------------- Block


class BlockIn(Schema):
    """A block as the client sends it.

    `id` is client-generated: the editor needs a stable identity before the
    block has ever reached the server, and reusing it as the primary key keeps
    citations, scroll-to-block and offline replay working across a save.
    """

    id: uuid.UUID
    type: BlockType = "TEXT"
    text: str = ""
    indent: int = Field(default=0, ge=0, le=10)
    tags: list[str] = Field(default_factory=list)
    classification: Classification = None
    props: dict[str, Any] = Field(default_factory=dict)
    task: Task | None = None


class BlockOut(BlockIn):
    updated_at: datetime


# --------------------------------------------------------------------- Page


class PageOut(Schema):
    id: uuid.UUID
    section_id: uuid.UUID
    kind: PageKind
    title: str
    date: Date | None
    blocks: list[BlockOut]
    created_at: datetime
    updated_at: datetime


class PageSummaryOut(Schema):
    id: uuid.UUID
    section_id: uuid.UUID
    kind: PageKind
    title: str
    date: Date | None
    updated_at: datetime
    preview: str
    activity: int


class PageSave(Schema):
    """Full-page save.

    Blocks are sent whole rather than as a patch: a note is small, the editor
    already holds the entire array, and replacing it makes ordering and deletion
    trivially correct. `base_updated_at` is the optimistic-concurrency token —
    see `ConflictError`.
    """

    title: str | None = None
    blocks: list[BlockIn]
    base_updated_at: datetime | None = None


class PageCreate(Schema):
    section_id: uuid.UUID
    title: str = "Untitled page"
    # Optional client-generated id. The editor may create a page while offline,
    # and it must keep the same identity once it reaches the server — otherwise
    # queued edits to it have nothing to attach to.
    id: uuid.UUID | None = None


class DailyClaim(Schema):
    """Body for PUT /daily/{day}: claim a date, optionally with a known id."""

    id: uuid.UUID | None = None


# ------------------------------------------------------- Notebook / Section


class NotebookOut(Schema):
    id: uuid.UUID
    name: str
    color: str


class NotebookCreate(Schema):
    name: str = Field(min_length=1, max_length=200)
    color: str | None = None


class SectionOut(Schema):
    id: uuid.UUID
    notebook_id: uuid.UUID
    name: str
    color: str


class SectionCreate(Schema):
    notebook_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)
    color: str | None = None


# ------------------------------------------------------------------- Search


class SearchHitOut(Schema):
    page_id: uuid.UUID
    block_id: uuid.UUID
    date: Date | None
    title: str
    type: BlockType
    heading: str | None
    snippet: str
    spans: list[tuple[int, int]]
    score: float


class PendingTaskOut(Schema):
    page: PageSummaryOut
    block: BlockOut


# ---------------------------------------------------------------- Analytics


class DayCount(Schema):
    date: Date
    done: int
    total: int


class TagCount(Schema):
    tag: str
    count: int


class DayReflectionOut(Schema):
    date: Date
    intent: str = ""
    went_well: str = ""
    blockers: str = ""
    focus_minutes: int = 0
    tasks_done: int = 0
    tasks_open: int = 0


class DayReflectionSave(Schema):
    """Upsert body. The date comes from the path, never the payload."""

    intent: str = ""
    went_well: str = ""
    blockers: str = ""
    focus_minutes: int = Field(default=0, ge=0)
    tasks_done: int = Field(default=0, ge=0)
    tasks_open: int = Field(default=0, ge=0)


# ------------------------------------------------------------------- Retro


class Goal(Schema):
    text: str = Field(min_length=1, max_length=200)
    tag: str | None = None
    target_min: int = Field(default=0, ge=0)


class GoalScore(Schema):
    text: str
    tag: str | None = None
    target_min: int = 0
    actual_min: int = 0


class WeekSummaryOut(Schema):
    week_start: Date
    narrative: str = ""
    highlights: list[str] = Field(default_factory=list)
    dropped: list[str] = Field(default_factory=list)
    focus_by_tag: dict[str, int] = Field(default_factory=dict)
    goals: list[Goal] = Field(default_factory=list)
    goal_scores: list[GoalScore] = Field(default_factory=list)
    generated_at: datetime | None = None


class GoalsSave(Schema):
    goals: list[Goal] = Field(default_factory=list, max_length=5)


# ------------------------------------------------------------------ AI chat


class ChatMessage(Schema):
    role: Literal["user", "assistant"]
    text: str


class ChatRequest(Schema):
    # Capped so one runaway thread cannot push an unbounded transcript at the
    # model; the tool layer, not the history, is where depth comes from.
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)


class CitationOut(Schema):
    date: Date | None = None
    page_id: uuid.UUID
    block_id: uuid.UUID
    label: str


class ChatResponse(Schema):
    text: str
    citations: list[CitationOut] = Field(default_factory=list)


class AiStatusOut(Schema):
    """Whether a hosted model is usable, so the client can pick a provider."""

    enabled: bool
    model: str | None = None


class WeeklyStatsOut(Schema):
    from_: Date = Field(alias="from")
    to: Date
    tasks_total: int
    tasks_done: int
    carried_forward: int
    high_priority_done: int
    professional: int
    personal: int
    estimate_min: int
    actual_min: int
    top_tags: list[TagCount]
    best_day: Date | None
    per_day: list[DayCount]
