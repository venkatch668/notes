"""Initial schema: notebooks, sections, pages, blocks, search.

Revision ID: 0001
Create Date: 2026-08-08
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    # ------------------------------------------------------------ notebooks
    op.create_table(
        "notebooks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("color", sa.String(20), nullable=False, server_default="#7719AA"),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index("ix_notebooks_user_id", "notebooks", ["user_id"])
    op.create_index("ix_notebooks_user_position", "notebooks", ["user_id", "position"])

    # ------------------------------------------------------------- sections
    op.create_table(
        "sections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("notebook_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("color", sa.String(20), nullable=False, server_default="#7719AA"),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index("ix_sections_user_id", "sections", ["user_id"])
    op.create_index("ix_sections_user_notebook", "sections",
                    ["user_id", "notebook_id", "position"])

    # ---------------------------------------------------------------- pages
    op.create_table(
        "pages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("section_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("sections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False, server_default="free"),
        sa.Column("title", sa.String(500), nullable=False, server_default=""),
        sa.Column("date", sa.Date, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.CheckConstraint("kind in ('daily', 'free')", name="ck_pages_kind"),
        sa.CheckConstraint(
            "(kind = 'daily' and date is not null) or (kind = 'free')",
            name="ck_pages_daily_has_date",
        ),
    )
    op.create_index("ix_pages_user_id", "pages", ["user_id"])
    op.create_index("ix_pages_user_date", "pages", ["user_id", "date"])
    op.create_index("ix_pages_user_section_updated", "pages",
                    ["user_id", "section_id", "updated_at"])
    # "One note per day" is a database invariant, not an application habit.
    op.create_index(
        "uq_pages_user_date_daily", "pages", ["user_id", "date"],
        unique=True, postgresql_where=sa.text("kind = 'daily'"),
    )

    # --------------------------------------------------------------- blocks
    op.create_table(
        "blocks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("page_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("pages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer, nullable=False),
        sa.Column("type", sa.String(20), nullable=False, server_default="TEXT"),
        sa.Column("text", sa.Text, nullable=False, server_default=""),
        sa.Column("indent", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tags", postgresql.ARRAY(sa.Text), nullable=False,
                  server_default=sa.text("'{}'::text[]")),
        sa.Column("classification", sa.String(20), nullable=True),
        sa.Column("props", postgresql.JSONB, nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("task", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )

    # The search vector is GENERATED: Postgres recomputes it on every write, so
    # the index can never drift from the text the way an application-maintained
    # column eventually does.
    #
    # Only `text` is indexed, deliberately. Two reasons:
    #
    #   1. A generated column's expression must be IMMUTABLE. `array_to_string`
    #      is only STABLE (its result depends on the element type's output
    #      function), so folding `tags` in is rejected outright by Postgres.
    #   2. It would be redundant anyway. Tags are *parsed out of* the text by
    #      the editor, so a block tagged `kafka` already contains "#kafka" in
    #      its text, and the default parser tokenises that to "kafka".
    #
    # Tag filtering is served by the GIN index on `tags` below, which is both
    # exact and faster than a full-text match for that purpose.
    op.execute(
        """
        ALTER TABLE blocks
        ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (
            to_tsvector('english', coalesce(text, ''))
        ) STORED
        """
    )

    op.create_index("ix_blocks_user_id", "blocks", ["user_id"])
    op.create_index("ix_blocks_page_position", "blocks", ["page_id", "position"])
    op.create_index("ix_blocks_search", "blocks", ["search_vector"], postgresql_using="gin")
    op.create_index("ix_blocks_tags", "blocks", ["tags"], postgresql_using="gin")
    op.create_index("ix_blocks_user_tasks", "blocks", ["user_id"],
                    postgresql_where=sa.text("task is not null"))

    # Deferred so a whole-page save may pass through intermediate states where
    # two blocks briefly share a position.
    op.execute(
        """
        ALTER TABLE blocks
        ADD CONSTRAINT uq_blocks_page_position UNIQUE (page_id, position)
        DEFERRABLE INITIALLY DEFERRED
        """
    )

    # ------------------------------------------------------------------ RLS
    # Defence in depth. The API connects as the owner role and bypasses these,
    # but if anything ever reaches this database with an end-user Supabase key,
    # rows stay scoped to their owner rather than being world-readable.
    for table in ("notebooks", "sections", "pages", "blocks"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY {table}_owner ON {table}
            FOR ALL
            USING (user_id = auth.uid())
            WITH CHECK (user_id = auth.uid())
            """
        )


def downgrade() -> None:
    for table in ("blocks", "pages", "sections", "notebooks"):
        op.execute(f"DROP POLICY IF EXISTS {table}_owner ON {table}")
    op.drop_table("blocks")
    op.drop_table("pages")
    op.drop_table("sections")
    op.drop_table("notebooks")
