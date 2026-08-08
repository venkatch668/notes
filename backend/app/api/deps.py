"""Shared FastAPI dependencies."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_session
from app.errors import AuthError
from app.security import CurrentUser, get_verifier

DbSession = Annotated[AsyncSession, Depends(get_session)]


async def current_user(
    authorization: Annotated[str | None, Header()] = None,
    settings: Annotated[Settings, Depends(get_settings)] = None,  # type: ignore[assignment]
) -> CurrentUser:
    """Resolves the caller from a Supabase access token.

    `auth_disabled` exists so the API can be exercised locally without standing
    up Supabase. It refuses to work in production — a misconfigured deploy
    should fail loudly, not quietly serve everyone the same notebook.
    """
    if settings.auth_disabled:
        if settings.is_production:
            raise AuthError("Authentication cannot be disabled in production")
        return CurrentUser(id=uuid.UUID(settings.dev_user_id), email="dev@localhost")

    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthError("Missing bearer token")

    token = authorization.split(" ", 1)[1].strip()
    return await get_verifier().verify(token)


CurrentUserDep = Annotated[CurrentUser, Depends(current_user)]
