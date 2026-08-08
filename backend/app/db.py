"""Database engine and session management.

One engine per process, one session per request. Nothing above the repository
layer imports this module — services receive a session, they never create one.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings

_settings = get_settings()

# Supabase's pooler (port 6543) runs PgBouncer in transaction mode, which
# multiplexes many client connections onto few server backends. Three things
# follow, and missing any one of them produces `DuplicatePreparedStatementError`
# under even light concurrency:
#
#   1. Turn off both statement caches. A statement prepared for one client is
#      not visible to the next, so caching just guarantees misses.
#   2. Give every prepared statement a UNIQUE name. This is the one that is
#      easy to miss: asyncpg names them sequentially (`__asyncpg_stmt_8__`), so
#      two clients landing on the same server backend collide on the name even
#      with caching disabled.
#   3. Do not pool on top of the pooler — hence NullPool.
#
# All three are harmless against a direct Postgres connection, so the same
# configuration is safe everywhere.
_is_pooled = ":6543" in _settings.database_url

_base_connect_args: dict = {"server_settings": {"application_name": "work-notebook-api"}}

_pooler_connect_args: dict = {
    **_base_connect_args,
    "statement_cache_size": 0,
    "prepared_statement_cache_size": 0,
    "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4()}__",
}

engine: AsyncEngine = create_async_engine(
    _settings.database_url,
    echo=_settings.db_echo,
    poolclass=NullPool if _is_pooled else None,
    connect_args=_pooler_connect_args if _is_pooled else _base_connect_args,
)

SessionFactory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,  # DTOs are built after commit; avoid lazy refetches
    autoflush=False,
)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: one transactional session per request.

    Commits on success, rolls back on any exception. Routes therefore never
    call `commit()` themselves, which keeps "did this endpoint remember to
    commit?" from being a class of bug.
    """
    async with SessionFactory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def dispose_engine() -> None:
    await engine.dispose()
