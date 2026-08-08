-- ===========================================================================
--  Work Notebook — initial schema
--  Generated from alembic revision 0001. Run this in:
--     Supabase → SQL Editor → New query → paste → Run
--
--  Safe to run on an empty project. The whole script is one transaction, so a
--  failure leaves nothing behind and it can simply be re-run.
--
--  Registers alembic revision 0001 at the end, so a later `alembic upgrade
--  head` from the API picks up at 0002 instead of recreating these tables.
-- ===========================================================================

BEGIN;

CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL, 
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> 0001

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE notebooks (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    user_id UUID NOT NULL, 
    name VARCHAR(200) NOT NULL, 
    color VARCHAR(20) DEFAULT '#7719AA' NOT NULL, 
    position INTEGER DEFAULT '0' NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id)
);

CREATE INDEX ix_notebooks_user_id ON notebooks (user_id);

CREATE INDEX ix_notebooks_user_position ON notebooks (user_id, position);

CREATE TABLE sections (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    user_id UUID NOT NULL, 
    notebook_id UUID NOT NULL, 
    name VARCHAR(200) NOT NULL, 
    color VARCHAR(20) DEFAULT '#7719AA' NOT NULL, 
    position INTEGER DEFAULT '0' NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(notebook_id) REFERENCES notebooks (id) ON DELETE CASCADE
);

CREATE INDEX ix_sections_user_id ON sections (user_id);

CREATE INDEX ix_sections_user_notebook ON sections (user_id, notebook_id, position);

CREATE TABLE pages (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    user_id UUID NOT NULL, 
    section_id UUID NOT NULL, 
    kind VARCHAR(10) DEFAULT 'free' NOT NULL, 
    title VARCHAR(500) DEFAULT '' NOT NULL, 
    date DATE, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT ck_pages_kind CHECK (kind in ('daily', 'free')), 
    CONSTRAINT ck_pages_daily_has_date CHECK ((kind = 'daily' and date is not null) or (kind = 'free')), 
    FOREIGN KEY(section_id) REFERENCES sections (id) ON DELETE CASCADE
);

CREATE INDEX ix_pages_user_id ON pages (user_id);

CREATE INDEX ix_pages_user_date ON pages (user_id, date);

CREATE INDEX ix_pages_user_section_updated ON pages (user_id, section_id, updated_at);

CREATE UNIQUE INDEX uq_pages_user_date_daily ON pages (user_id, date) WHERE kind = 'daily';

CREATE TABLE blocks (
    id UUID NOT NULL, 
    user_id UUID NOT NULL, 
    page_id UUID NOT NULL, 
    position INTEGER NOT NULL, 
    type VARCHAR(20) DEFAULT 'TEXT' NOT NULL, 
    text TEXT DEFAULT '' NOT NULL, 
    indent INTEGER DEFAULT '0' NOT NULL, 
    tags TEXT[] DEFAULT '{}'::text[] NOT NULL, 
    classification VARCHAR(20), 
    props JSONB DEFAULT '{}'::jsonb NOT NULL, 
    task JSONB, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(page_id) REFERENCES pages (id) ON DELETE CASCADE
);

ALTER TABLE blocks
        ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (
            to_tsvector('english', coalesce(text, ''))
        ) STORED;

CREATE INDEX ix_blocks_user_id ON blocks (user_id);

CREATE INDEX ix_blocks_page_position ON blocks (page_id, position);

CREATE INDEX ix_blocks_search ON blocks USING gin (search_vector);

CREATE INDEX ix_blocks_tags ON blocks USING gin (tags);

CREATE INDEX ix_blocks_user_tasks ON blocks (user_id) WHERE task is not null;

ALTER TABLE blocks
        ADD CONSTRAINT uq_blocks_page_position UNIQUE (page_id, position)
        DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE notebooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY notebooks_owner ON notebooks
            FOR ALL
            USING (user_id = auth.uid())
            WITH CHECK (user_id = auth.uid());

ALTER TABLE sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY sections_owner ON sections
            FOR ALL
            USING (user_id = auth.uid())
            WITH CHECK (user_id = auth.uid());

ALTER TABLE pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY pages_owner ON pages
            FOR ALL
            USING (user_id = auth.uid())
            WITH CHECK (user_id = auth.uid());

ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY blocks_owner ON blocks
            FOR ALL
            USING (user_id = auth.uid())
            WITH CHECK (user_id = auth.uid());

INSERT INTO alembic_version (version_num) VALUES ('0001') RETURNING alembic_version.version_num;

COMMIT;


-- ---------------------------------------------------------------------------
--  Verification — run separately after the script above succeeds.
-- ---------------------------------------------------------------------------

-- 1. Four tables, RLS on all of them:
-- SELECT tablename, rowsecurity FROM pg_tables
--  WHERE schemaname='public' AND tablename IN ('notebooks','sections','pages','blocks')
--  ORDER BY tablename;

-- 2. The generated search column exists and is STORED:
-- SELECT column_name, is_generated FROM information_schema.columns
--  WHERE table_name='blocks' AND column_name='search_vector';

-- 3. Full-text search actually works end to end:
-- SELECT to_tsvector('english', 'Verify Kafka notification flow #professional')
--        @@ websearch_to_tsquery('english', 'kafka') AS finds_kafka,
--        to_tsvector('english', 'Verify Kafka notification flow #professional')
--        @@ websearch_to_tsquery('english', 'professional') AS finds_tag;
--   Expect both true — which is why tags need no separate tsvector.
