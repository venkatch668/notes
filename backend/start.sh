#!/usr/bin/env bash
# Render start command. Migrations run before the first worker accepts traffic,
# so a deploy can never serve requests against an older schema.
set -euo pipefail

echo "Running database migrations..."
alembic upgrade head

echo "Starting API on port ${PORT:-8000}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers "${WEB_CONCURRENCY:-2}"
