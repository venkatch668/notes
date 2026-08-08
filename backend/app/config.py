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
