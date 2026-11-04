-- A payment reference has several log entries over its life (failed, paid, refund_pending,
-- refunded...), so each status should be unique per reference, not the reference itself.
-- Run this BEFORE deploying the code that depends on it: its ON CONFLICT clauses need this constraint.
BEGIN;

ALTER TABLE payment_logs DROP CONSTRAINT IF EXISTS payment_logs_payment_reference_key;
ALTER TABLE payment_logs DROP CONSTRAINT IF EXISTS payment_logs_reference_status_key;
ALTER TABLE payment_logs ADD CONSTRAINT payment_logs_reference_status_key UNIQUE (payment_reference, status);

COMMIT;
