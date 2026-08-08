# Work Notebook API

FastAPI + async SQLAlchemy over Supabase Postgres. Deployed on Render.

## Layering

Dependencies point one way. Nothing below reaches up.

```
app/api/          HTTP only — parse request, call one service, shape response
   ↓
app/services/     Business rules. No SQL, no FastAPI imports.
   ↓
app/repositories/ All SQL lives here. Every function takes user_id.
   ↓
app/models.py     SQLAlchemy schema
```

Supporting modules: `config.py` (all environment input), `db.py` (engine +
per-request session), `security.py` (Supabase JWT verification), `errors.py`
(typed failures → HTTP status, decided in one place), `schemas.py` (the wire
contract, camelCase, mirroring `frontend/src/types/models.ts`).

Three rules keep it maintainable:

1. **A route with an `if` expressing a product rule is a bug.** Move it to a service.
2. **Every repository function takes `user_id` first.** Ownership is not optional.
3. **Schemas mirror the TypeScript types.** Change one, change the other.

## Local development

```bash
cd backend
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
# source .venv/bin/activate && pip install -r requirements.txt  # macOS/Linux

cp .env.example .env        # then fill in DATABASE_URL
alembic upgrade head
uvicorn app.main:app --reload
```

- API docs: http://127.0.0.1:8000/docs
- Liveness: `/health` · Readiness (checks the DB): `/health/ready`

Set `AUTH_DISABLED=true` in `.env` to work without Supabase tokens locally. The
API refuses to honour that flag when `ENVIRONMENT=production`.

## Supabase setup

1. Create a project. Note the region — put Render in the same one.
2. **Settings → Database → Connection string → URI.** Use the **pooler** host
   (port `6543`) for Render. Paste it into `DATABASE_URL` exactly as shown; the
   `postgresql://` prefix is rewritten to the async driver automatically.
3. **Settings → API** → copy the project URL into `SUPABASE_URL`. If the project
   still issues HS256 tokens, also copy the JWT secret into
   `SUPABASE_JWT_SECRET`.
4. `alembic upgrade head` creates the schema.

### Why the pooler matters

Supabase's pooler runs PgBouncer in transaction mode. `db.py` detects port 6543
and disables both asyncpg's prepared-statement cache and SQLAlchemy's own pool —
without that, queries fail intermittently under concurrency in a way that is
painful to diagnose. Direct connections are unaffected.

## Deploying to Render

The repo root has `render.yaml`. Render → **New → Blueprint** → pick this repo.
Then set the three secret values in the dashboard:

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Supabase → Settings → Database → URI (**pooler, port 6543**) |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_JWT_SECRET` | Supabase → Settings → API → JWT Secret (HS256 projects only) |

`start.sh` runs `alembic upgrade head` before starting uvicorn, so a deploy can
never serve traffic against an older schema.

## Schema notes

- **`pages`** has a partial unique index on `(user_id, date) WHERE kind='daily'`.
  "One note per day" is enforced by the database, not by application discipline.
- **`blocks`** are rows, not a JSON column. Search, task queries and per-block
  sync all need to address blocks individually.
- **`blocks.search_vector`** is a `GENERATED ALWAYS` tsvector over `text` alone,
  with a GIN index. Postgres maintains it, so it cannot drift.
  Tags are **not** folded into the vector. A generated expression must be
  IMMUTABLE and `array_to_string` is only STABLE, so Postgres rejects it — and
  it would be redundant regardless: tags are parsed *out of* the text, so a
  block tagged `kafka` already contains "#kafka", which the parser tokenises to
  "kafka". Tag *filtering* uses the GIN index on `tags`, which is exact and
  cheaper for that job.
- **RLS** is enabled on every table with an `auth.uid()` policy. The API connects
  as the owner role and bypasses it; the policies are defence in depth for the
  day something reaches the database with an end-user key.

## Concurrency and sync

`PUT /pages/{id}` accepts `baseUpdatedAt` — the `updated_at` the client's edit
was based on. If the server has moved on, the write is refused with **409** and
the server's timestamp, so the client can merge instead of silently clobbering.
This is what makes the offline queue safe to replay.

## Testing

```bash
./.venv/Scripts/python.exe -m pytest -q
```

Pure logic (query parsing, snippet offsets) is tested without a database.
Repository and route tests need a Postgres to point at.
