"""POST /v1/webhooks/transactions - acknowledge fast, process later.

The request path does only two cheap things: validate and one INSERT.
The 30 s work happens in a background task, so the response time does
not depend on processing load.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from fastapi import APIRouter, Depends, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app import repository as repo
from app.config import Settings
from app.deps import get_processor, get_session, get_settings_dep
from app.models import Transaction
from app.processor import Processor
from app.schemas import ErrorResponse, WebhookAck, WebhookTransactionIn
from app.security import SignatureError, verify_signature

router = APIRouter(prefix="/v1/webhooks", tags=["webhooks"])
log = logging.getLogger("app.webhooks")


def _same_payload(existing: Transaction, incoming: WebhookTransactionIn) -> bool:
    return (
        existing.source_account == incoming.source_account
        and existing.destination_account == incoming.destination_account
        and Decimal(str(existing.original_amount)) == incoming.amount
        and existing.original_currency == incoming.currency
    )


@router.post(
    "/transactions",
    status_code=202,
    response_model=WebhookAck,
    summary="Receive a transaction webhook",
    responses={
        401: {"model": ErrorResponse, "description": "Missing/invalid signature"},
        409: {"model": ErrorResponse, "description": "Same transaction_id, different payload"},
        422: {"description": "Invalid payload"},
        503: {"model": ErrorResponse, "description": "Storage unavailable - sender should retry"},
    },
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": WebhookTransactionIn.model_json_schema()}},
        }
    },
)
async def receive_transaction_webhook(
    request: Request,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
    processor: Processor = Depends(get_processor),
):
    body = await request.body()  # raw bytes are needed for the HMAC check

    try:
        verify_signature(body, request.headers.get(settings.signature_header), settings)
    except SignatureError as exc:
        log.warning("rejected webhook: %s", exc)
        return JSONResponse(status_code=401, content={"detail": str(exc)})

    try:
        payload = WebhookTransactionIn.model_validate_json(body)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors(include_url=False, include_context=False)) from exc

    try:
        created = await repo.insert_if_absent(
            session,
            repo.NewTransaction(
                transaction_id=payload.transaction_id,
                source_account=payload.source_account,
                destination_account=payload.destination_account,
                amount=payload.amount,
                currency=payload.currency,
            ),
        )
        existing = None if created else await repo.get(session, payload.transaction_id)
    except SQLAlchemyError:
        # We could not durably store it, so we must NOT say 202. A non-2xx makes
        # the payment processor retry later. Nothing is lost.
        log.exception("could not store webhook %s", payload.transaction_id)
        return JSONResponse(status_code=503, content={"detail": "Storage temporarily unavailable, retry later"})

    if created:
        processor.schedule(payload.transaction_id)
        log.info("accepted %s", payload.transaction_id)
        return WebhookAck(status="accepted", transaction_id=payload.transaction_id)

    if existing is not None and not _same_payload(existing, payload):
        log.warning("conflicting duplicate for %s", payload.transaction_id)
        return JSONResponse(
            status_code=409,
            content={
                "detail": "transaction_id already exists with a different payload",
                "transaction_id": payload.transaction_id,
            },
        )

    log.info("duplicate %s ignored (status=%s)", payload.transaction_id, existing.status if existing else "?")
    return WebhookAck(status="duplicate", transaction_id=payload.transaction_id)
