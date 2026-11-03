"""Data access. Every state change is a single conditional SQL statement, which is
what makes idempotency and "exactly one processing" hold under concurrency.

All timestamps are computed in Python (UTC) and passed as parameters so the same
SQL works on Postgres and SQLite.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import Select, and_, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import as_utc, utcnow
from app.models import Transaction, TxnStatus


@dataclass(frozen=True)
class NewTransaction:
    transaction_id: str
    source_account: str
    destination_account: str
    amount: Decimal
    currency: str


@dataclass(frozen=True)
class Claim:
    transaction_id: str
    original_amount: Decimal
    original_currency: str
    attempts: int
    locked_until: datetime  # lease token: identifies *this* claim


def _insert_for(session: AsyncSession):
    return sqlite_insert if session.bind.dialect.name == "sqlite" else pg_insert


async def insert_if_absent(session: AsyncSession, txn: NewTransaction) -> bool:
    """INSERT ... ON CONFLICT DO NOTHING. Returns True only for the request that created the row."""
    now = utcnow()
    insert = _insert_for(session)
    stmt = (
        insert(Transaction)
        .values(
            transaction_id=txn.transaction_id,
            source_account=txn.source_account,
            destination_account=txn.destination_account,
            original_amount=txn.amount,
            original_currency=txn.currency,
            status=TxnStatus.PROCESSING,
            attempts=0,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=["transaction_id"])
        .returning(Transaction.transaction_id)
    )
    result = await session.execute(stmt)
    created = result.scalar_one_or_none() is not None
    await session.commit()
    return created


async def get(session: AsyncSession, transaction_id: str) -> Transaction | None:
    return await session.get(Transaction, transaction_id)


async def list_transactions(
    session: AsyncSession, *, status: str | None, limit: int, offset: int
) -> tuple[list[Transaction], int]:
    base: Select = select(Transaction)
    count_stmt = select(func.count()).select_from(Transaction)
    if status:
        base = base.where(Transaction.status == status)
        count_stmt = count_stmt.where(Transaction.status == status)
    rows = await session.scalars(
        base.order_by(Transaction.created_at.desc(), Transaction.transaction_id).limit(limit).offset(offset)
    )
    total = await session.scalar(count_stmt)
    return list(rows), int(total or 0)


async def claim(session: AsyncSession, transaction_id: str, lease_seconds: float) -> Claim | None:
    """Take a time-limited lease on a PROCESSING row. Only one caller can win."""
    now = utcnow()
    lease = now + timedelta(seconds=lease_seconds)
    stmt = (
        update(Transaction)
        .where(
            Transaction.transaction_id == transaction_id,
            Transaction.status == TxnStatus.PROCESSING,
            or_(Transaction.locked_until.is_(None), Transaction.locked_until <= now),
        )
        .values(
            locked_until=lease,
            attempts=Transaction.attempts + 1,
            updated_at=now,
        )
        .returning(
            Transaction.transaction_id,
            Transaction.original_amount,
            Transaction.original_currency,
            Transaction.attempts,
        )
    )
    row = (await session.execute(stmt)).one_or_none()
    await session.commit()
    if row is None:
        return None
    return Claim(
        transaction_id=row.transaction_id,
        original_amount=Decimal(str(row.original_amount)),
        original_currency=row.original_currency,
        attempts=row.attempts,
        locked_until=lease,
    )


async def mark_processed(
    session: AsyncSession,
    transaction_id: str,
    *,
    amount_inr: Decimal,
    fx_rate_to_inr: Decimal,
    fx_rate_as_of: date,
) -> bool:
    now = utcnow()
    stmt = (
        update(Transaction)
        .where(Transaction.transaction_id == transaction_id, Transaction.status == TxnStatus.PROCESSING)
        .values(
            status=TxnStatus.PROCESSED,
            amount_inr=amount_inr,
            fx_rate_to_inr=fx_rate_to_inr,
            fx_rate_as_of=fx_rate_as_of,
            processed_at=now,
            locked_until=None,
            last_error=None,
            updated_at=now,
        )
    )
    result = await session.execute(stmt)
    await session.commit()
    return result.rowcount == 1


async def mark_failed(session: AsyncSession, transaction_id: str, error: str) -> bool:
    now = utcnow()
    stmt = (
        update(Transaction)
        .where(Transaction.transaction_id == transaction_id, Transaction.status == TxnStatus.PROCESSING)
        .values(status=TxnStatus.FAILED, last_error=error[:1000], locked_until=None, updated_at=now)
    )
    result = await session.execute(stmt)
    await session.commit()
    return result.rowcount == 1


async def schedule_retry(
    session: AsyncSession, transaction_id: str, error: str, retry_in: float, lease: datetime
) -> datetime:
    """Record the error and keep holding the lease until the retry time. Returns the new lease."""
    now = utcnow()
    new_lease = now + timedelta(seconds=retry_in)
    await session.execute(
        update(Transaction)
        .where(
            Transaction.transaction_id == transaction_id,
            Transaction.status == TxnStatus.PROCESSING,
            Transaction.locked_until == lease,
        )
        .values(last_error=error[:1000], locked_until=new_lease, updated_at=now)
    )
    await session.commit()
    return new_lease


async def release_lease(session: AsyncSession, transaction_id: str, lease: datetime) -> None:
    """Graceful shutdown: give the row back so a restarted instance resumes immediately.
    Only releases the lease if it is still ours."""
    await session.execute(
        update(Transaction)
        .where(
            Transaction.transaction_id == transaction_id,
            Transaction.status == TxnStatus.PROCESSING,
            Transaction.locked_until == lease,
        )
        .values(locked_until=None, updated_at=utcnow())
    )
    await session.commit()


async def find_stale(session: AsyncSession, *, unclaimed_after: float, limit: int = 100) -> list[str]:
    """PROCESSING rows nobody is working on: lease expired, or never claimed for a while."""
    now = utcnow()
    stmt = (
        select(Transaction.transaction_id)
        .where(
            Transaction.status == TxnStatus.PROCESSING,
            or_(
                Transaction.locked_until <= now,
                and_(
                    Transaction.locked_until.is_(None),
                    Transaction.created_at <= now - timedelta(seconds=unclaimed_after),
                ),
            ),
        )
        .order_by(Transaction.created_at)
        .limit(limit)
    )
    return list(await session.scalars(stmt))


async def status_counts(session: AsyncSession) -> dict[str, int]:
    rows = await session.execute(select(Transaction.status, func.count()).group_by(Transaction.status))
    return {status: int(n) for status, n in rows}


async def oldest_processing_created_at(session: AsyncSession) -> datetime | None:
    value = await session.scalar(
        select(func.min(Transaction.created_at)).where(Transaction.status == TxnStatus.PROCESSING)
    )
    return as_utc(value)


async def recent_processing_durations(session: AsyncSession, n: int = 50) -> list[float]:
    """Seconds from created to processed for the latest `n` PROCESSED rows (computed in Python: portable)."""
    rows = await session.execute(
        select(Transaction.created_at, Transaction.processed_at)
        .where(Transaction.status == TxnStatus.PROCESSED, Transaction.processed_at.is_not(None))
        .order_by(Transaction.processed_at.desc())
        .limit(n)
    )
    return [(as_utc(done) - as_utc(created)).total_seconds() for created, done in rows]
