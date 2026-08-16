-- ===========================================================================
--  Work Notebook — retrospection tables (day_reflections, week_summaries)
--  Generated from alembic revision 0002. Run this in:
--     Supabase → SQL Editor → New query → paste → Run
--
--  Prerequisite: 001_initial_schema.sql has already been applied, so
--  `alembic_version` exists and holds '0001'.
--
--  One transaction, so a failure leaves nothing behind and it can be re-run.
--  Every CREATE is IF NOT EXISTS and the version bump is idempotent, so
--  running it a second time is harmless.
-- ===========================================================================

BEGIN;

-- Running upgrade 0001 -> 0002

CREATE TABLE IF NOT EXISTS day_reflections (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    user_id UUID NOT NULL,
    date DATE NOT NULL,
    intent TEXT DEFAULT '' NOT NULL,
    went_well TEXT DEFAULT '' NOT NULL,
    blockers TEXT DEFAULT '' NOT NULL,
    focus_minutes INTEGER DEFAULT 0 NOT NULL,
    tasks_done INTEGER DEFAULT 0 NOT NULL,
    tasks_open INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    -- Makes "save today's reflection" an upsert rather than a read-then-write
    -- race, and enforces the one-per-day rule the product rests on.
    CONSTRAINT uq_day_reflections_user_date UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS ix_day_reflections_user_id
    ON day_reflections (user_id);

CREATE TABLE IF NOT EXISTS week_summaries (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    user_id UUID NOT NULL,
    week_start DATE NOT NULL,
    narrative TEXT DEFAULT '' NOT NULL,
    highlights JSONB DEFAULT '[]' NOT NULL,
    dropped JSONB DEFAULT '[]' NOT NULL,
    focus_by_tag JSONB DEFAULT '{}' NOT NULL,
    -- Goals for the FOLLOWING week: [{ text, tag, targetMin }].
    goals JSONB DEFAULT '[]' NOT NULL,
    goal_scores JSONB DEFAULT '[]' NOT NULL,
    generated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_week_summaries_user_week UNIQUE (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS ix_week_summaries_user_id
    ON week_summaries (user_id);

-- ---------------------------------------------------------------------------
--  Row-level security, matching notebooks/sections/pages/blocks.
--
--  The API already filters by user_id on every query; this is the backstop for
--  the day someone forgets. CREATE POLICY has no IF NOT EXISTS, so each one is
--  dropped first to keep the script re-runnable.
-- ---------------------------------------------------------------------------

ALTER TABLE day_reflections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS day_reflections_owner ON day_reflections;
CREATE POLICY day_reflections_owner ON day_reflections
            FOR ALL
            USING (user_id = auth.uid())
            WITH CHECK (user_id = auth.uid());

ALTER TABLE week_summaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS week_summaries_owner ON week_summaries;
CREATE POLICY week_summaries_owner ON week_summaries
            FOR ALL
            USING (user_id = auth.uid())
            WITH CHECK (user_id = auth.uid());

-- Move the recorded revision to 0002 so a later `alembic upgrade head` from
-- the API starts at 0003 rather than trying to recreate these tables.
UPDATE alembic_version SET version_num = '0002' WHERE version_num = '0001';

COMMIT;


-- ---------------------------------------------------------------------------
--  Verification — run separately after the script above succeeds.
-- ---------------------------------------------------------------------------

-- 1. Both tables exist with RLS on:
-- SELECT tablename, rowsecurity FROM pg_tables
--  WHERE schemaname='public' AND tablename IN ('day_reflections','week_summaries')
--  ORDER BY tablename;

-- 2. Alembic is at 0002:
-- SELECT version_num FROM alembic_version;

-- 3. The one-per-day rule bites (the second insert must fail):
-- INSERT INTO day_reflections (user_id, date, intent)
--      VALUES ('00000000-0000-0000-0000-000000000001', CURRENT_DATE, 'first');
-- INSERT INTO day_reflections (user_id, date, intent)
--      VALUES ('00000000-0000-0000-0000-000000000001', CURRENT_DATE, 'second');
-- DELETE FROM day_reflections
--  WHERE user_id = '00000000-0000-0000-0000-000000000001';
