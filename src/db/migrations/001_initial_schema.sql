CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id           TEXT UNIQUE NOT NULL,
  cached_balance_paise  BIGINT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE brands (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id),
  brand_id       UUID NOT NULL REFERENCES brands(id),
  earning_paise  BIGINT NOT NULL CHECK (earning_paise >= 0),
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconciled_at  TIMESTAMPTZ
);

CREATE INDEX idx_sales_user_status ON sales(user_id, status);
CREATE INDEX idx_sales_pending ON sales(status) WHERE status = 'pending';

CREATE TABLE advance_payouts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id       UUID NOT NULL UNIQUE REFERENCES sales(id),
  user_id       UUID NOT NULL REFERENCES users(id),
  amount_paise  BIGINT NOT NULL CHECK (amount_paise > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_advance_payouts_user ON advance_payouts(user_id);

CREATE TABLE ledger_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id),
  amount_paise   BIGINT NOT NULL,
  entry_type     TEXT NOT NULL CHECK (entry_type IN (
                   'advance_payout',
                   'final_approval_credit',
                   'rejection_adjustment',
                   'withdrawal_debit',
                   'withdrawal_refund'
                 )),
  reference_type TEXT NOT NULL CHECK (reference_type IN ('sale', 'withdrawal')),
  reference_id   UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ledger_user_created ON ledger_entries(user_id, created_at DESC);

CREATE UNIQUE INDEX uq_ledger_ref
  ON ledger_entries(reference_type, reference_id, entry_type);

CREATE TABLE withdrawals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  amount_paise  BIGINT NOT NULL CHECK (amount_paise > 0),
  status        TEXT NOT NULL DEFAULT 'initiated'
                CHECK (status IN ('initiated', 'success', 'failed', 'cancelled', 'rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX idx_withdrawals_user_created ON withdrawals(user_id, created_at DESC);
CREATE INDEX idx_withdrawals_user_success ON withdrawals(user_id, resolved_at DESC)
  WHERE status = 'success';
