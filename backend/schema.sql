-- Reference DDL for PostgreSQL (Supabase).
-- The app creates this automatically on startup (SQLAlchemy create_all), so you do NOT
-- need to run it. It is here for review and for DBAs who prefer explicit migrations.

CREATE TABLE IF NOT EXISTS transactions (
    transaction_id      VARCHAR(64)   PRIMARY KEY,          -- idempotency key
    source_account      VARCHAR(64)   NOT NULL,
    destination_account VARCHAR(64)   NOT NULL,

    original_amount     NUMERIC(18,4) NOT NULL,             -- exactly as received
    original_currency   VARCHAR(3)    NOT NULL,

    amount_inr          NUMERIC(18,4),                      -- set when PROCESSED
    fx_rate_to_inr      NUMERIC(18,8),
    fx_rate_as_of       DATE,

    status              VARCHAR(16)   NOT NULL DEFAULT 'PROCESSING',
    attempts            INTEGER       NOT NULL DEFAULT 0,
    last_error          TEXT,
    locked_until        TIMESTAMPTZ,                        -- processing lease

    created_at          TIMESTAMPTZ   NOT NULL,
    updated_at          TIMESTAMPTZ   NOT NULL,
    processed_at        TIMESTAMPTZ,

    CONSTRAINT ck_transactions_status          CHECK (status IN ('PROCESSING','PROCESSED','FAILED')),
    CONSTRAINT ck_transactions_currency        CHECK (original_currency IN ('INR','USD','EUR','GBP')),
    CONSTRAINT ck_transactions_amount_positive CHECK (original_amount > 0)
);

-- Lets the recovery sweeper find unfinished work quickly.
CREATE INDEX IF NOT EXISTS ix_transactions_processing_lease
    ON transactions (locked_until) WHERE status = 'PROCESSING';

CREATE INDEX IF NOT EXISTS ix_transactions_created_at ON transactions (created_at);
