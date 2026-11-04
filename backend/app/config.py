"""Application settings, loaded from environment variables (and an optional .env file).

Every tunable value lives here so behaviour can change per environment
(local / test / Render) without code changes.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from functools import lru_cache

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SUPPORTED_CURRENCIES: tuple[str, ...] = ("INR", "USD", "EUR", "GBP")
BASE_CURRENCY = "INR"

# Fixed rates: INR per 1 unit of the currency (owner-supplied snapshot, 2026-11-03).
# Override with the FX_RATES_TO_INR env var (JSON). See docs/assumptions.md.
DEFAULT_FX_RATES_TO_INR: dict[str, Decimal] = {
    "INR": Decimal("1"),
    "USD": Decimal("94.75"),
    "EUR": Decimal("106.08"),
    "GBP": Decimal("127.14"),
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Database -----------------------------------------------------------
    # Postgres in production (Supabase). SQLite is supported for local dev/tests.
    database_url: str = "sqlite+aiosqlite:///./local.db"
    api_db_pool_size: int = 5
    api_db_max_overflow: int = 5
    worker_db_pool_size: int = 3
    worker_db_max_overflow: int = 2

    # --- Background processing ---------------------------------------------
    processing_delay_seconds: float = 30.0  # simulated external API call
    lease_seconds: float = 90.0  # how long a worker "owns" a transaction
    max_attempts: int = 3
    retry_backoff_seconds: float = 2.0  # backoff = base * 2^(attempt-1)
    sweeper_interval_seconds: float = 30.0
    stale_unclaimed_seconds: float = 10.0  # PROCESSING rows never claimed after this are rescheduled
    max_concurrent_jobs: int = 500
    simulated_failure_rate: float = Field(default=0.0, ge=0.0, le=1.0)
    sweeper_enabled: bool = True

    # --- Webhook security ---------------------------------------------------
    webhook_secret: str | None = None
    signature_required: bool = False
    signature_header: str = "X-Razorpay-Signature"

    # --- HTTP -----------------------------------------------------------------
    cors_origins: str = "http://localhost:5173"  # comma-separated, or "*"
    frontend_url: str | None = None  # where GET /dashboard redirects; unset = no redirect

    # --- Currency -------------------------------------------------------------
    fx_rates_to_inr: dict[str, Decimal] = Field(default_factory=lambda: dict(DEFAULT_FX_RATES_TO_INR))
    fx_rates_as_of: date = date(2026, 11, 3)

    # --- Misc -------------------------------------------------------------------
    log_level: str = "INFO"

    @field_validator("webhook_secret", "frontend_url", mode="before")
    @classmethod
    def _empty_is_none(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v

    @field_validator("fx_rates_to_inr")
    @classmethod
    def _validate_rates(cls, rates: dict[str, Decimal]) -> dict[str, Decimal]:
        rates = {k.upper(): Decimal(str(v)) for k, v in rates.items()}
        missing = set(SUPPORTED_CURRENCIES) - set(rates)
        extra = set(rates) - set(SUPPORTED_CURRENCIES)
        if missing or extra:
            raise ValueError(
                f"FX_RATES_TO_INR must contain exactly {SUPPORTED_CURRENCIES}; "
                f"missing={sorted(missing)} extra={sorted(extra)}"
            )
        if rates[BASE_CURRENCY] != Decimal("1"):
            raise ValueError("FX rate for INR must be exactly 1")
        if any(v <= 0 for v in rates.values()):
            raise ValueError("FX rates must be positive")
        return rates

    @model_validator(mode="after")
    def _validate_consistency(self) -> "Settings":
        if self.signature_required and not self.webhook_secret:
            raise ValueError("SIGNATURE_REQUIRED=true needs WEBHOOK_SECRET to be set")
        if self.lease_seconds <= self.processing_delay_seconds:
            raise ValueError("LEASE_SECONDS must be greater than PROCESSING_DELAY_SECONDS")
        if self.max_attempts < 1:
            raise ValueError("MAX_ATTEMPTS must be >= 1")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
