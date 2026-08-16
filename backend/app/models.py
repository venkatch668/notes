"""SQLAlchemy models — the physical schema.

Shape mirrors the TypeScript domain in `frontend/src/types/models.ts`; the two
must stay in step, so any change here needs the matching change there.

Two decisions worth knowing:

  * Blocks are **rows, not a JSON column** on the page. A JSON blob would be
    simpler to write, but full-text search, task queries and per-block sync all
    need to address blocks individually, and none of those work well inside a
    document column.
  * `user_id` is denormalised onto every table. It costs a column and buys the
    ability to filter by owner without a join on every single query — the check
    that must never be accidentally omitted.
"""

from __future__ import annotations

import uuid
from datetime import date as Date
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Computed,
    Date as SQLDate,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR, UUID as PgUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Notebook(Base, TimestampMixin):
    __tablename__ = "notebooks"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#7719AA")
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    sections: Mapped[list[Section]] = relationship(
        back_populates="notebook", cascade="all, delete-orphan", order_by="Section.position"
    )

    __table_args__ = (Index("ix_notebooks_user_position", "user_id", "position"),)


class Section(Base, TimestampMixin):
    __tablename__ = "sections"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False, index=True)
    notebook_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#7719AA")
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    notebook: Mapped[Notebook] = relationship(back_populates="sections")
    pages: Mapped[list[Page]] = relationship(
        back_populates="section", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_sections_user_notebook", "user_id", "notebook_id", "position"),)


class Page(Base, TimestampMixin):
    __tablename__ = "pages"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False, index=True)
    section_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sections.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default="free")
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    # Set for daily pages only. The partial unique index below is what actually
    # enforces "one note per day" — the invariant the whole product rests on.
    date: Mapped[Date | None] = mapped_column(SQLDate, nullable=True)

    section: Mapped[Section] = relationship(back_populates="pages")
    blocks: Mapped[list[Block]] = relationship(
        back_populates="page",
        cascade="all, delete-orphan",
        order_by="Block.position",
        lazy="selectin",
    )

    __table_args__ = (
        CheckConstraint("kind in ('daily', 'free')", name="ck_pages_kind"),
        CheckConstraint(
            "(kind = 'daily' and date is not null) or (kind = 'free')",
            name="ck_pages_daily_has_date",
        ),
        Index(
            "uq_pages_user_date_daily",
            "user_id",
            "date",
            unique=True,
            postgresql_where="kind = 'daily'",
        ),
        Index("ix_pages_user_section_updated", "user_id", "section_id", "updated_at"),
        Index("ix_pages_user_date", "user_id", "date"),
    )


class DayReflection(Base, TimestampMixin):
    """One row per day: what you meant to do, and what actually happened.

    Kept out of the note body deliberately. Blocks are free-form text the user
    owns; this is structured data the retro reads, and mixing the two would
    mean parsing prose to answer "did the week match the intent".

    The counters are snapshots taken at close time, not live aggregates —
    editing a note weeks later must not rewrite what that day felt like.
    """

    __tablename__ = "day_reflections"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False, index=True)
    date: Mapped[Date] = mapped_column(SQLDate, nullable=False)

    intent: Mapped[str] = mapped_column(Text, nullable=False, default="")
    went_well: Mapped[str] = mapped_column(Text, nullable=False, default="")
    blockers: Mapped[str] = mapped_column(Text, nullable=False, default="")

    focus_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tasks_done: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tasks_open: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint("user_id", "date", name="uq_day_reflections_user_date"),
    )


class WeekSummary(Base, TimestampMixin):
    """The written retro for one week, plus the focus goals set for the next.

    Generated text is persisted rather than recomputed on every view: it costs
    a model call, it must not change under you between two readings of the same
    week, and week-over-week comparison needs something durable to compare.
    """

    __tablename__ = "week_summaries"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False, index=True)
    week_start: Mapped[Date] = mapped_column(SQLDate, nullable=False)

    narrative: Mapped[str] = mapped_column(Text, nullable=False, default="")
    highlights: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    dropped: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    focus_by_tag: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # Goals for the *following* week: [{ text, tag, targetMin }]. Scored against
    # that week's actual focus minutes, deterministically — the model writes the
    # prose, never the numbers.
    goals: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    goal_scores: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "week_start", name="uq_week_summaries_user_week"),
    )


class Block(Base, TimestampMixin):
    __tablename__ = "blocks"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False, index=True)
    page_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("pages.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    type: Mapped[str] = mapped_column(String(20), nullable=False, default="TEXT")
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    indent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    classification: Mapped[str | None] = mapped_column(String(20), nullable=True)
    props: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # Null for non-checkbox blocks. Kept as JSONB rather than eight columns
    # because the attribute set is still moving; promote to columns if a
    # attribute ever needs its own index beyond the expression indexes below.
    # none_as_null=True is essential: by default SQLAlchemy writes Python None
    # as a JSON `null` *value*, which is NOT SQL NULL. Every `task IS NOT NULL`
    # filter would then match headings and paragraphs too.
    task: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True), nullable=True)

    # Maintained by Postgres, never by the application — it cannot drift.
    # `Computed` is what tells SQLAlchemy to leave this column out of INSERT and
    # UPDATE entirely; without it Postgres rejects the write with
    # GeneratedAlwaysError. The expression must match the migration exactly.
    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('english', coalesce(text, ''))", persisted=True),
        nullable=True,
    )

    page: Mapped[Page] = relationship(back_populates="blocks")

    __table_args__ = (
        UniqueConstraint("page_id", "position", name="uq_blocks_page_position",
                         deferrable=True, initially="DEFERRED"),
        Index("ix_blocks_page_position", "page_id", "position"),
        Index("ix_blocks_search", "search_vector", postgresql_using="gin"),
        Index("ix_blocks_tags", "tags", postgresql_using="gin"),
        Index(
            "ix_blocks_user_tasks",
            "user_id",
            postgresql_where="task is not null",
        ),
    )
