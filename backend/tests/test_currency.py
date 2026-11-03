"""Pure unit tests for money math and FX configuration (no database)."""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.config import DEFAULT_FX_RATES_TO_INR
from app.config import Settings
from app.currency import UnsupportedCurrencyError, display_amount, from_inr, round_display, to_inr

RATES = {"INR": Decimal("1"), "USD": Decimal("84.00"), "EUR": Decimal("91.00"), "GBP": Decimal("109.00")}  # test-local


def test_default_rates_are_the_owner_supplied_ones():
    assert DEFAULT_FX_RATES_TO_INR == {
        "INR": Decimal("1"), "USD": Decimal("94.75"), "EUR": Decimal("106.08"), "GBP": Decimal("127.14")
    }
    assert Settings(_env_file=None).fx_rates_to_inr == DEFAULT_FX_RATES_TO_INR


@pytest.mark.parametrize(
    "value, expected",
    [
        ("0.125", "0.12"),  # half -> even (down)
        ("0.135", "0.14"),  # half -> even (up)
        ("2.665", "2.66"),
        ("2.675", "2.68"),
        ("10.005", "10.00"),
        ("10.015", "10.02"),
        ("1.2349", "1.23"),
        ("1.2351", "1.24"),
    ],
)
def test_bankers_rounding(value, expected):
    assert round_display(Decimal(value)) == Decimal(expected)


def test_to_inr_uses_rate_and_returns_it():
    amount_inr, rate = to_inr(Decimal("100"), "USD", RATES)
    assert amount_inr == Decimal("8400.0000")
    assert rate == Decimal("84.00")


def test_to_inr_identity_for_inr():
    assert to_inr(Decimal("1500"), "INR", RATES) == (Decimal("1500.0000"), Decimal("1"))


def test_from_inr_rounds_half_even():
    # 8400 / 91 = 92.307692... -> 92.31
    assert from_inr(Decimal("8400"), "EUR", RATES) == Decimal("92.31")
    assert from_inr(Decimal("1500"), "INR", RATES) == Decimal("1500.00")


def test_display_same_currency_returns_original_without_drift():
    assert display_amount(
        original_amount=Decimal("150.50"), original_currency="USD", amount_inr=Decimal("12642"), target="USD", rates=RATES
    ) == Decimal("150.50")


def test_display_unprocessed_row_uses_current_rates():
    # 1500 INR -> USD: 1500/84 = 17.857142 -> 17.86
    assert display_amount(
        original_amount=Decimal("1500"), original_currency="INR", amount_inr=None, target="USD", rates=RATES
    ) == Decimal("17.86")


def test_unsupported_currency_raises():
    with pytest.raises(UnsupportedCurrencyError):
        to_inr(Decimal("1"), "JPY", RATES)
    with pytest.raises(UnsupportedCurrencyError):
        from_inr(Decimal("1"), "JPY", RATES)


def test_fx_config_must_cover_exactly_supported_currencies():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, fx_rates_to_inr={"INR": 1, "USD": 84})
    with pytest.raises(ValidationError):
        Settings(_env_file=None, fx_rates_to_inr={"INR": 2, "USD": 84, "EUR": 91, "GBP": 109})
    with pytest.raises(ValidationError):
        Settings(_env_file=None, fx_rates_to_inr={"INR": 1, "USD": 0, "EUR": 91, "GBP": 109})


def test_fx_config_accepts_json_env(monkeypatch):
    monkeypatch.setenv("FX_RATES_TO_INR", '{"INR": 1, "USD": 83.5, "EUR": 90, "GBP": 108.25}')
    s = Settings(_env_file=None)
    assert s.fx_rates_to_inr["USD"] == Decimal("83.5")
    assert s.fx_rates_to_inr["GBP"] == Decimal("108.25")


def test_lease_must_exceed_delay():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, processing_delay_seconds=30, lease_seconds=30)
