"""Day reflections and week summaries — the retrospection store.

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-16

Both tables are one row per (user, period), enforced by a unique constraint so
"generate the retro" is an upsert and can be replayed safely.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------- day_reflections
    op.create_table(
        "day_reflections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("intent", sa.Text, nullable=False, server_default=""),
        sa.Column("went_well", sa.Text, nullable=False, server_default=""),
        sa.Column("blockers", sa.Text, nullable=False, server_default=""),
        sa.Column("focus_minutes", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tasks_done", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tasks_open", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "date", name="uq_day_reflections_user_date"),
    )
    op.create_index("ix_day_reflections_user_id", "day_reflections", ["user_id"])

    # -------------------------------------------------------- week_summaries
    op.create_table(
        "week_summaries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("week_start", sa.Date, nullable=False),
        sa.Column("narrative", sa.Text, nullable=False, server_default=""),
        sa.Column("highlights", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("dropped", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("focus_by_tag", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("goals", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("goal_scores", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "week_start", name="uq_week_summaries_user_week"),
    )
    op.create_index("ix_week_summaries_user_id", "week_summaries", ["user_id"])

    # Row-level security, matching the existing tables: the API filters by
    # user_id on every query, and this is the backstop if one ever forgets to.
    for table in ("day_reflections", "week_summaries"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY {table}_owner ON {table} "
            "FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())"
        )


def downgrade() -> None:
    op.drop_table("week_summaries")
    op.drop_table("day_reflections")
