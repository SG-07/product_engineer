"""Webhook signature verification (RazorPay style: hex HMAC-SHA256 of the raw body)."""

from __future__ import annotations

import hashlib
import hmac

from app.config import Settings


class SignatureError(Exception):
    pass


def compute_signature(body: bytes, secret: str) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def verify_signature(body: bytes, header_value: str | None, settings: Settings) -> None:
    """Raise SignatureError if the request must be rejected.

    Rules (see docs/decisions.md):
      * signature present + secret configured -> must match
      * signature missing -> rejected only when SIGNATURE_REQUIRED=true
      * no secret configured -> signatures cannot be checked, so they are ignored
    """
    secret = settings.webhook_secret
    if not header_value:
        if settings.signature_required:
            raise SignatureError("Missing webhook signature")
        return
    if not secret:
        return
    provided = header_value.strip()
    if provided.lower().startswith("sha256="):
        provided = provided[7:]
    expected = compute_signature(body, secret)
    if not hmac.compare_digest(provided.lower(), expected):
        raise SignatureError("Invalid webhook signature")
