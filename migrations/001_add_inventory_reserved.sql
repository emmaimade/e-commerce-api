-- Stock is now reserved at checkout instead of deducted at payment.
-- inventory_reserved is true while an order's stock is deducted from inventory.
BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS inventory_reserved BOOLEAN NOT NULL DEFAULT false;

-- Existing paid, non-cancelled orders already had stock deducted at payment time.
-- Unpaid orders placed before this change hold no stock, so they stay false and
-- are deducted on payment (or simply expire).
UPDATE orders
SET inventory_reserved = true
WHERE status = 'paid' AND order_status <> 'cancelled';

-- Speeds up the unpaid-order expiry job
CREATE INDEX IF NOT EXISTS idx_orders_pending_placed_at
  ON orders(placed_at) WHERE order_status = 'pending';

COMMIT;
