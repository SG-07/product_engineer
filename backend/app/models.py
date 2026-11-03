"""Database model. One table: `transactions` (see schema.sql for the Postgres DDL)."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import CheckConstraint, Date, DateTime, Index, Integer, Numeric, String, Text, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TxnStatus(StrEnum):
    PROCESSING = "PROCESSING"
    PROCESSED = "PROCESSED"
    FAILED = "FAILED"


class Transaction(Base):
    __tablename__ = "transactions"

    # Primary key = idempotency key. The DB guarantees one row per transaction_id.
    transaction_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_account: Mapped[str] = mapped_column(String(64), nullable=False)
    destination_account: Mapped[str] = mapped_column(String(64), nullable=False)

    # Exactly what the payment processor sent (kept for audit + duplicate comparison).
    original_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    original_currency: Mapped[str] = mapped_column(String(3), nullable=False)

    # Filled in by the background processor.
    amount_inr: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    fx_rate_to_inr: Mapped[Decimal | None] = mapped_column(Numeric(18, 8), nullable=True)
    fx_rate_as_of: Mapped[date | None] = mapped_column(Date, nullable=True)

    status: Mapped[str] = mapped_column(String(16), nullable=False, default=TxnStatus.PROCESSING)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Lease: while locked_until is in the future, one worker owns this row.
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("status IN ('PROCESSING','PROCESSED','FAILED')", name="ck_transactions_status"),
        CheckConstraint("original_currency IN ('INR','USD','EUR','GBP')", name="ck_transactions_currency"),
        CheckConstraint("original_amount > 0", name="ck_transactions_amount_positive"),
        # Used by the recovery sweeper to find work quickly.
        Index(
            "ix_transactions_processing_lease",
            "locked_until",
            postgresql_where=text("status = 'PROCESSING'"),
            sqlite_where=text("status = 'PROCESSING'"),
        ),
        Index("ix_transactions_created_at", "created_at"),
    )
