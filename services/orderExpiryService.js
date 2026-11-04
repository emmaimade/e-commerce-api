import db from "../config/db.js";
import { releaseOrderInventory } from "./inventoryService.js";
import { withTransaction } from "../utils/transaction.js";

// Matches the payment window promised in the order confirmation email
const PAYMENT_WINDOW_HOURS = 24;
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Returns true if the order was expired, false if it no longer qualifies
const expireOrder = (id) =>
  withTransaction(async (client) => {
    // Re-check under lock; skip orders a payment is currently being applied to
    const locked = await client.query(
      `SELECT id FROM orders
      WHERE id = $1 AND order_status = 'pending' AND status <> 'paid'
      FOR UPDATE SKIP LOCKED`,
      [id]
    );

    if (locked.rows.length === 0) return false;

    await client.query(
      "UPDATE orders SET order_status = 'cancelled', updated_at = now() WHERE id = $1",
      [id]
    );

    await releaseOrderInventory(id, client);

    await client.query(
      "INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)",
      [id, "cancelled", `Order expired: payment not received within ${PAYMENT_WINDOW_HOURS} hours`]
    );

    return true;
  });

// Cancel unpaid orders past the payment window and release their stock
export const expireUnpaidOrders = async () => {
  const stale = await db.query(
    `SELECT id FROM orders
    WHERE order_status = 'pending' AND status <> 'paid'
      AND placed_at < now() - make_interval(hours => $1)`,
    [PAYMENT_WINDOW_HOURS]
  );

  let expiredCount = 0;

  for (const { id } of stale.rows) {
    try {
      if (await expireOrder(id)) expiredCount++;
    } catch (err) {
      console.error(`Failed to expire order ${id}:`, err.message);
    }
  }

  if (expiredCount > 0) {
    console.log(`Expired ${expiredCount} unpaid order(s)`);
  }
};

export const startOrderExpiryJob = () => {
  const run = () =>
    expireUnpaidOrders().catch((err) =>
      console.error("Order expiry job failed:", err.message)
    );

  run();
  return setInterval(run, CHECK_INTERVAL_MS);
};
