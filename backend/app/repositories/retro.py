"""Persistence for the retrospection store.

Two entities, both keyed one-per-period-per-user: `day_reflections` (what you
meant to do and what happened) and `week_summaries` (the written retro plus the
focus goals for the week after).

Both writes are upserts against the unique constraint rather than a
read-then-write. Closing the same day twice is normal — you edit the evening
entry, you regenerate a retro — and a select-then-insert would race itself.
"""

from __future__ import annotations

import uuid
from datetime import date as Date

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DayReflection, WeekSummary


# ---------------------------------------------------------- Day reflections


async def get_reflection(
    session: AsyncSession, user_id: uuid.UUID, day: Date
) -> DayReflection | None:
    result = await session.execute(
        select(DayReflection).where(
            DayReflection.user_id == user_id, DayReflection.date == day
        )
    )
    return result.scalar_one_or_none()


async def list_reflections(
    session: AsyncSession, user_id: uuid.UUID, start: Date, end: Date
) -> list[DayReflection]:
    result = await session.execute(
        select(DayReflection)
        .where(
            DayReflection.user_id == user_id,
            DayReflection.date >= start,
            DayReflection.date <= end,
        )
        .order_by(DayReflection.date)
    )
    return list(result.scalars())


async def save_reflection(
    session: AsyncSession, user_id: uuid.UUID, day: Date, values: dict
) -> DayReflection:
    stmt = (
        insert(DayReflection)
        .values(user_id=user_id, date=day, **values)
        .on_conflict_do_update(
            constraint="uq_day_reflections_user_date",
            set_=values,
        )
        .returning(DayReflection)
    )
    # No commit here: `get_session` owns the transaction and commits once the
    # request succeeds, so committing mid-request would split one unit of work
    # into two and lose the all-or-nothing guarantee.
    #
    # populate_existing is not optional. RETURNING hands back a row for an
    # entity that may already be in the session's identity map, and by default
    # the ORM keeps the object it already has — attributes and all. The caller
    # then gets the values from *before* the upsert. It only bites when
    # something still holds a reference (the identity map is weak), which makes
    # it exactly the kind of bug that passes in a test and fails in a request.
    result = await session.execute(stmt, execution_options={"populate_existing": True})
    return result.scalar_one()


# ----------------------------------------------------------- Week summaries


async def get_week_summary(
    session: AsyncSession, user_id: uuid.UUID, week_start: Date
) -> WeekSummary | None:
    result = await session.execute(
        select(WeekSummary).where(
            WeekSummary.user_id == user_id, WeekSummary.week_start == week_start
        )
    )
    return result.scalar_one_or_none()


async def save_week_summary(
    session: AsyncSession, user_id: uuid.UUID, week_start: Date, values: dict
) -> WeekSummary:
    """Upsert. Only the keys supplied are written.

    That partial behaviour is the point: setting next week's goals must not
    wipe the narrative, and regenerating the narrative must not wipe the goals
    you already committed to.
    """
    stmt = (
        insert(WeekSummary)
        .values(user_id=user_id, week_start=week_start, **values)
        .on_conflict_do_update(
            constraint="uq_week_summaries_user_week",
            set_=values,
        )
        .returning(WeekSummary)
    )
    # No commit here: `get_session` owns the transaction and commits once the
    # request succeeds, so committing mid-request would split one unit of work
    # into two and lose the all-or-nothing guarantee.
    #
    # populate_existing is not optional. RETURNING hands back a row for an
    # entity that may already be in the session's identity map, and by default
    # the ORM keeps the object it already has — attributes and all. The caller
    # then gets the values from *before* the upsert. It only bites when
    # something still holds a reference (the identity map is weak), which makes
    # it exactly the kind of bug that passes in a test and fails in a request.
    result = await session.execute(stmt, execution_options={"populate_existing": True})
    return result.scalar_one()
