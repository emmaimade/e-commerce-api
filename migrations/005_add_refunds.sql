-- Refunds become a saved record before any call to Paystack, so a crash or an
-- outage can't lose one. One refund per payment, and refunds are always in full.
CREATE TABLE IF NOT EXISTS refunds (
  id SERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id),
  payment_reference VARCHAR(255) NOT NULL UNIQUE,
  amount INTEGER NOT NULL, -- Amount in naira
  status VARCHAR(20) NOT NULL DEFAULT 'required', -- 'required', 'processing', 'pending', 'processed', 'failed'
  requested_by VARCHAR(50) NOT NULL, -- 'user', 'admin', 'late_payment'
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
