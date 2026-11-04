"""Read endpoints: one transaction (as a one-element array, as sketched in backend_task.md), or a paginated list.
`?currency=` picks the display currency."""

from __future__ import annotations

from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app import repository as repo
from app.config import SUPPORTED_CURRENCIES, Settings
from app.currency import display_amount
from app.db import as_utc
from app.deps import get_session, get_settings_dep
from app.models import Transaction
from app.schemas import ErrorResponse, TransactionList, TransactionOut

router = APIRouter(prefix="/v1/transactions", tags=["transactions"])

CURRENCY_QUERY = Query(
    default=None,
    description="Display currency: INR, USD, EUR or GBP. Omit to get the amount exactly as received.",
    examples=["USD"],
)


def _parse_currency(currency: str | None) -> str | None:
    if currency is None:
        return None
    code = currency.strip().upper()
    if code not in SUPPORTED_CURRENCIES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported currency '{currency}'. Supported: {', '.join(SUPPORTED_CURRENCIES)}",
        )
    return code


def _dec(v) -> Decimal | None:
    return None if v is None else Decimal(str(v))


def to_out(txn: Transaction, currency: str | None, settings: Settings) -> TransactionOut:
    original_amount = _dec(txn.original_amount)
    amount_inr = _dec(txn.amount_inr)
    if currency is None:
        shown_currency, shown_amount = txn.original_currency, original_amount
    else:
        shown_currency = currency
        shown_amount = display_amount(
            original_amount=original_amount,
            original_currency=txn.original_currency,
            amount_inr=amount_inr,
            target=currency,
            rates=settings.fx_rates_to_inr,
        )
    return TransactionOut(
        transaction_id=txn.transaction_id,
        source_account=txn.source_account,
        destination_account=txn.destination_account,
        amount=shown_amount,
        currency=shown_currency,
        original_amount=original_amount,
        original_currency=txn.original_currency,
        amount_inr=amount_inr,
        fx_rate_to_inr=_dec(txn.fx_rate_to_inr),
        fx_rate_as_of=txn.fx_rate_as_of,
        status=txn.status,
        attempts=txn.attempts,
        last_error=txn.last_error,
        created_at=as_utc(txn.created_at),
        processed_at=as_utc(txn.processed_at),
    )


@router.get(
    "/{transaction_id}",
    response_model=list[TransactionOut],
    summary="Get one transaction's status (a one-element array, as in backend_task.md)",
    responses={404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
)
async def get_transaction(
    transaction_id: str,
    currency: str | None = CURRENCY_QUERY,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> list[TransactionOut]:
    code = _parse_currency(currency)
    txn = await repo.get(session, transaction_id)
    if txn is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return [to_out(txn, code, settings)]


@router.get("", response_model=TransactionList, summary="List transactions (newest first)")
async def list_transactions(
    status: Literal["PROCESSING", "PROCESSED", "FAILED"] | None = Query(default=None),
    currency: str | None = CURRENCY_QUERY,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> TransactionList:
    code = _parse_currency(currency)
    rows, total = await repo.list_transactions(session, status=status, limit=limit, offset=offset)
    return TransactionList(items=[to_out(t, code, settings) for t in rows], total=total, limit=limit, offset=offset)
