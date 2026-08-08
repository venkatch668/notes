"""Typed application errors.

Services raise these; one exception handler in `main.py` turns them into HTTP
responses. Services therefore never import FastAPI, and the HTTP status for a
given failure is decided in exactly one place.
"""

from __future__ import annotations


class AppError(Exception):
    """Base class for expected, client-facing failures."""

    status_code: int = 500
    code: str = "internal_error"

    def __init__(self, message: str, *, details: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class AuthError(AppError):
    status_code = 401
    code = "unauthorized"


class ForbiddenError(AppError):
    status_code = 403
    code = "forbidden"


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class ValidationError(AppError):
    status_code = 422
    code = "validation_error"


class ConflictError(AppError):
    """Raised when a write would clobber a newer server-side version.

    Central to the offline sync model: the client sends the `updated_at` it
    based its edit on, and a mismatch returns 409 with the server's copy so the
    client can merge rather than silently overwrite.
    """

    status_code = 409
    code = "conflict"
