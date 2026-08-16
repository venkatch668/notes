"""Application settings.

Everything environment-specific enters the app here and nowhere else. If a
module needs a URL, a key or a flag, it takes it from `get_settings()` rather
than reading `os.environ` directly — that keeps configuration testable and
makes the full set of required variables discoverable in one file.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Runtime -----------------------------------------------------------
    environment: Literal["local", "staging", "production"] = "local"
    log_level: str = "INFO"

    # --- Database ----------------------------------------------------------
    # Supabase → Project Settings → Database → Connection string → URI.
    # Use the *pooler* host (port 6543) for serverless-style hosts like Render;
    # see `db.py` for why that forces prepared statements off.
    database_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/notebook",
    )
    db_echo: bool = False

    # --- Auth (Supabase) ---------------------------------------------------
    # Supabase issues either HS256 tokens signed with the project's JWT secret
    # (legacy) or asymmetric tokens verified through JWKS (current). Configure
    # whichever your project uses; JWKS wins when both are present.
    supabase_url: str | None = None
    # Explicit override; otherwise derived from supabase_url below.
    supabase_jwks_url: str | None = None
    supabase_jwt_secret: str | None = None
    supabase_jwt_audience: str = "authenticated"

    # Escape hatch for local development only — never enable off a laptop.
    auth_disabled: bool = False
    dev_user_id: str = "00000000-0000-0000-0000-000000000001"

    # --- AI (Gemini) -------------------------------------------------------
    # Google AI Studio → Get API key. Server-side only, deliberately: a key in
    # the browser bundle is a key anyone who opens devtools can spend.
    # Absent means the hosted assistant is simply switched off — the client
    # falls back to the local extractive provider rather than erroring.
    gemini_api_key: str | None = None
    # A pinned, current model rather than a `-latest` alias. Aliases move under
    # you — behaviour and cost change with no diff — and the one time it was
    # tried it answered 503 "high demand" while the pinned names were fine.
    # Verify with GET /v1beta/models before changing this; the list endpoint
    # still advertises `gemini-2.5-flash`, which generateContent now rejects
    # with 404 for keys that were not already using it.
    gemini_model: str = "gemini-3.5-flash"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    # One wall-clock ceiling for a whole chat turn, tool round-trips included.
    gemini_timeout_s: float = 45.0

    @property
    def ai_enabled(self) -> bool:
        return bool(self.gemini_api_key)

    # --- HTTP --------------------------------------------------------------
    # Held as a raw string, not list[str], on purpose: pydantic-settings tries
    # to JSON-decode complex types straight from the environment, before any
    # validator can run, so `CORS_ORIGINS=a,b` fails to parse. Every platform
    # we deploy to (Render, Docker, .env) supplies this as a comma-separated
    # string, so take a string and split it ourselves.
    cors_origins: str = "http://localhost:5173,https://venkatch668.github.io"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @field_validator("database_url", mode="before")
    @classmethod
    def _normalise_driver(cls, v: object) -> object:
        """Accept the URL exactly as Supabase prints it.

        Supabase hands out `postgresql://…`, but SQLAlchemy needs the async
        driver named explicitly. Rewriting it here means nobody has to remember
        to edit the string they pasted out of the dashboard.
        """
        if isinstance(v, str):
            if v.startswith("postgres://"):
                v = v.replace("postgres://", "postgresql://", 1)
            if v.startswith("postgresql://"):
                v = v.replace("postgresql://", "postgresql+asyncpg://", 1)
        return v

    @property
    def jwks_url(self) -> str | None:
        """Where to fetch token signing keys.

        An explicit `SUPABASE_JWKS_URL` wins; otherwise it is derived from the
        project URL, which is where Supabase publishes it by default.
        """
        if self.supabase_jwks_url:
            return self.supabase_jwks_url
        if self.supabase_url:
            return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        return None

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    """Cached so the environment is parsed once per process."""
    return Settings()
