"""Request / response models (the public API contract)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator

CurrencyCode = Literal["INR", "USD", "EUR", "GBP"]

# Money is a Decimal internally; it is emitted as a plain JSON number.
Money = Annotated[Decimal, PlainSerializer(lambda v: float(v), return_type=float, when_used="json")]


def _iso_z(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


Timestamp = Annotated[datetime, PlainSerializer(_iso_z, return_type=str, when_used="json")]

Identifier = Annotated[str, Field(min_length=1, max_length=64)]


class WebhookTransactionIn(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    transaction_id: Identifier
    source_account: Identifier
    destination_account: Identifier
    amount: Annotated[Decimal, Field(gt=0, max_digits=18, decimal_places=4)]
    currency: CurrencyCode

    @field_validator("currency", mode="before")
    @classmethod
    def _upper(cls, v: object) -> object:
        return v.strip().upper() if isinstance(v, str) else v

    @field_validator("amount", mode="before")
    @classmethod
    def _no_bool_or_string(cls, v: object) -> object:
        # Reject booleans and strings: amount must be a JSON number.
        if isinstance(v, bool) or isinstance(v, str):
            raise ValueError("amount must be a JSON number")
        return v


class WebhookAck(BaseModel):
    status: Literal["accepted", "duplicate"]
    transaction_id: str


class ErrorResponse(BaseModel):
    detail: str


class HealthResponse(BaseModel):
    status: Literal["HEALTHY", "UNHEALTHY"]
    current_time: str


class TransactionOut(BaseModel):
    transaction_id: str
    source_account: str
    destination_account: str
    amount: Money = Field(description="Amount in `currency` (display currency).")
    currency: CurrencyCode = Field(description="Requested display currency, or the original one.")
    original_amount: Money
    original_currency: CurrencyCode
    amount_inr: Money | None = Field(description="Stored INR amount. null until PROCESSED.")
    fx_rate_to_inr: Money | None
    fx_rate_as_of: date | None
    status: Literal["PROCESSING", "PROCESSED", "FAILED"]
    attempts: int
    last_error: str | None
    created_at: Timestamp
    processed_at: Timestamp | None = Field(description="null while still processing.")


class TransactionList(BaseModel):
    items: list[TransactionOut]
    total: int
    limit: int
    offset: int


class CurrenciesOut(BaseModel):
    base: CurrencyCode
    supported: list[CurrencyCode]
    rates_to_inr: dict[str, Money]
    as_of: date
    display_decimals: int
    rounding: str
