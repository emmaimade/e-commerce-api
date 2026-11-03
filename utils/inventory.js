// Stock is held for an order while `orders.inventory_reserved` is true.
// It is reserved at checkout and released when the order is cancelled or expires.
// All functions run inside the caller's transaction.

// Lock the order's product rows (in a consistent order to avoid deadlocks)
// and return the quantity needed per product
const lockOrderProducts = async (client, orderId) => {
  await client.query(
    `SELECT id FROM products
    WHERE id IN (SELECT product_id FROM order_items WHERE order_id = $1)
    ORDER BY id
    FOR UPDATE`,
    [orderId]
  );

  const result = await client.query(
    `SELECT
        oi.product_id,
        p.name AS product_name,
        p.inventory_qty AS current_stock,
        SUM(oi.quantity)::int AS quantity
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = $1
    GROUP BY oi.product_id, p.name, p.inventory_qty
    ORDER BY oi.product_id`,
    [orderId]
  );

  return result.rows;
};

const deductStock = (client, productId, quantity) =>
  client.query(
    `UPDATE products
    SET inventory_qty = inventory_qty - $1,
        status = CASE WHEN inventory_qty - $1 = 0 THEN 'out_of_stock' ELSE status END,
        updated_at = now()
    WHERE id = $2`,
    [quantity, productId]
  );

// Reserve stock at checkout. Returns the items that don't have enough stock;
// if any are returned nothing was reserved and the caller should roll back.
export const reserveOrderInventory = async (orderId, client) => {
  const items = await lockOrderProducts(client, orderId);

  const insufficient = items.filter((item) => item.quantity > item.current_stock);
  if (insufficient.length > 0) return insufficient;

  for (const item of items) {
    await deductStock(client, item.product_id, item.quantity);
  }

  await client.query(
    "UPDATE orders SET inventory_reserved = true WHERE id = $1",
    [orderId]
  );

  return [];
};

// Return reserved stock to inventory. Safe to call more than once.
export const releaseOrderInventory = async (orderId, client) => {
  const claimed = await client.query(
    "UPDATE orders SET inventory_reserved = false WHERE id = $1 AND inventory_reserved RETURNING id",
    [orderId]
  );

  if (claimed.rows.length === 0) return false;

  const items = await lockOrderProducts(client, orderId);

  for (const item of items) {
    await client.query(
      `UPDATE products
      SET inventory_qty = inventory_qty + $1,
          status = CASE WHEN status = 'out_of_stock' THEN 'active' ELSE status END,
          updated_at = now()
      WHERE id = $2`,
      [item.quantity, item.product_id]
    );
  }

  console.log(`Released inventory for order ${orderId}`);
  return true;
};

// Called when payment is confirmed. Orders placed before checkout reservations
// existed have no stock held, so deduct it now.
export const updateProductInventory = async (orderId, client) => {
  const claimed = await client.query(
    "UPDATE orders SET inventory_reserved = true WHERE id = $1 AND NOT inventory_reserved RETURNING id",
    [orderId]
  );

  // Stock was already reserved at checkout
  if (claimed.rows.length === 0) return;

  const items = await lockOrderProducts(client, orderId);

  for (const item of items) {
    const { product_id, product_name, current_stock, quantity } = item;

    if (quantity > current_stock) {
      // Paid order exceeds available stock - needs manual follow-up (refund/backorder)
      console.error(
        `OVERSOLD: order ${orderId} needs ${quantity} x ${product_name} (${product_id}) but only ${current_stock} in stock`
      );
    }

    await deductStock(client, product_id, Math.min(quantity, current_stock));
  }

  console.log(`Updated inventory for legacy order ${orderId}`);
};
