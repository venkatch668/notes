"""Supabase JWT verification.

The browser talks to Supabase Auth directly for login; this service never sees
a password. It receives the resulting access token and does one job: prove the
token is genuine and extract the user id from it.

Two signing schemes are supported because Supabase projects differ:

  * asymmetric (current)  — RS256/ES256, public keys fetched from the project's
    JWKS endpoint and cached
  * shared secret (legacy) — HS256 signed with the project's JWT secret

JWKS is preferred when configured; the secret is the fallback.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from uuid import UUID

import httpx
from jose import jwt
from jose.exceptions import JWTError

from app.config import Settings, get_settings
from app.errors import AuthError

log = logging.getLogger(__name__)

_JWKS_TTL_SECONDS = 600


@dataclass(frozen=True)
class CurrentUser:
    """The authenticated caller. The only identity the rest of the app knows."""

    id: UUID
    email: str | None = None


class JwtVerifier:
    """Verifies Supabase access tokens, caching JWKS between requests."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._jwks: dict | None = None
        self._jwks_fetched_at: float = 0.0

    async def _get_jwks(self) -> dict | None:
        url = self._settings.jwks_url
        if not url:
            return None

        fresh = time.monotonic() - self._jwks_fetched_at < _JWKS_TTL_SECONDS
        if self._jwks is not None and fresh:
            return self._jwks

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url)
                response.raise_for_status()
                self._jwks = response.json()
                self._jwks_fetched_at = time.monotonic()
        except (httpx.HTTPError, ValueError) as exc:
            # A JWKS outage must not silently downgrade to "no verification".
            # Serve a stale copy if we have one, otherwise fail closed.
            log.warning("JWKS fetch failed: %s", exc)
            if self._jwks is None:
                raise AuthError("Unable to verify token signing keys") from exc

        return self._jwks

    async def verify(self, token: str) -> CurrentUser:
        claims = await self._decode(token)

        subject = claims.get("sub")
        if not subject:
            raise AuthError("Token is missing a subject claim")

        try:
            user_id = UUID(subject)
        except ValueError as exc:
            raise AuthError("Token subject is not a valid user id") from exc

        return CurrentUser(id=user_id, email=claims.get("email"))

    async def _decode(self, token: str) -> dict:
        options = {"verify_aud": bool(self._settings.supabase_jwt_audience)}
        audience = self._settings.supabase_jwt_audience or None

        jwks = await self._get_jwks()
        if jwks and jwks.get("keys"):
            try:
                return jwt.decode(
                    token,
                    jwks,
                    algorithms=["RS256", "ES256"],
                    audience=audience,
                    options=options,
                )
            except JWTError as exc:
                # Fall through to the shared secret only if one is configured;
                # otherwise this is a genuine verification failure.
                if not self._settings.supabase_jwt_secret:
                    raise AuthError("Invalid or expired token") from exc

        if self._settings.supabase_jwt_secret:
            try:
                return jwt.decode(
                    token,
                    self._settings.supabase_jwt_secret,
                    algorithms=["HS256"],
                    audience=audience,
                    options=options,
                )
            except JWTError as exc:
                raise AuthError("Invalid or expired token") from exc

        raise AuthError("Authentication is not configured on this server")


_verifier: JwtVerifier | None = None


def get_verifier() -> JwtVerifier:
    global _verifier
    if _verifier is None:
        _verifier = JwtVerifier(get_settings())
    return _verifier
