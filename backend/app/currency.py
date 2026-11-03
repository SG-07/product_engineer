"""All money math lives here. Never use float for money.

- Storage precision: 4 decimal places (NUMERIC(18,4)).
- Display precision: 2 decimal places, banker's rounding (ROUND_HALF_EVEN).
"""

from __future__ import annotations

from decimal import ROUND_HALF_EVEN, Decimal

from app.config import BASE_CURRENCY, SUPPORTED_CURRENCIES

STORAGE_QUANT = Decimal("0.0001")
DISPLAY_QUANT = Decimal("0.01")


class UnsupportedCurrencyError(ValueError):
    pass


def _check(currency: str) -> None:
    if currency not in SUPPORTED_CURRENCIES:
        raise UnsupportedCurrencyError(f"Unsupported currency: {currency}")


def round_display(amount: Decimal) -> Decimal:
    """Round to 2 decimals using banker's rounding (0.125 -> 0.12, 0.135 -> 0.14)."""
    return amount.quantize(DISPLAY_QUANT, rounding=ROUND_HALF_EVEN)


def round_storage(amount: Decimal) -> Decimal:
    return amount.quantize(STORAGE_QUANT, rounding=ROUND_HALF_EVEN)


def to_inr(amount: Decimal, currency: str, rates: dict[str, Decimal]) -> tuple[Decimal, Decimal]:
    """Convert an amount into INR. Returns (amount_inr, rate_used)."""
    _check(currency)
    rate = rates[currency]
    return round_storage(amount * rate), rate


def from_inr(amount_inr: Decimal, target: str, rates: dict[str, Decimal]) -> Decimal:
    """Convert an INR amount into the target currency, rounded for display."""
    _check(target)
    if target == BASE_CURRENCY:
        return round_display(amount_inr)
    return round_display(amount_inr / rates[target])


def display_amount(
    *,
    original_amount: Decimal,
    original_currency: str,
    amount_inr: Decimal | None,
    target: str,
    rates: dict[str, Decimal],
) -> Decimal:
    """Amount to show a viewer who prefers `target`.

    - Same currency as received -> the original amount (no round-trip drift).
    - Processed rows -> convert from the stored INR amount.
    - Rows still processing (no INR yet) -> convert via current config rates.
    """
    _check(target)
    if target == original_currency:
        return round_display(original_amount)
    if amount_inr is None:
        amount_inr, _ = to_inr(original_amount, original_currency, rates)
    return from_inr(amount_inr, target, rates)
