-- token_version lets the app revoke every token a user holds: tokens carry the
-- version they were issued with, and it goes up on password reset and logout.
-- reset_token_expiry was the only user timestamp without a time zone.
-- Run this BEFORE deploying the code that depends on it.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ALTER COLUMN reset_token_expiry TYPE TIMESTAMPTZ
  USING reset_token_expiry AT TIME ZONE 'UTC';

COMMIT;
