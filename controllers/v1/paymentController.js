import db from "../../config/db.js";
import crypto from "crypto";

// Webhook handler
export const handleWebhook = async (req, res) => {
  let parsedBody;
  let event;
  let reference;
  try {
    // Since you're using express.raw(), req.body is a Buffer
    const rawBody = req.body;
    if (!rawBody || rawBody.length === 0) {
      console.error("❌ Empty webhook body received");
      return res.status(400).json({
        success: false,
        message: "Empty request body",
      });
    }
    
    console.log("Raw body type:", typeof rawBody);
    console.log("Raw body:", rawBody);

    // Convert Buffer to string and parse JSON
    try {
      const bodyString = rawBody.toString('utf8');
      parsedBody = JSON.parse(bodyString);
    } catch (parseError) {
      console.error("❌ Failed to parse webhook body:", parseError);
      return res.status(400).json({
        success: false,
        message: "Invalid JSON body",
      });
    }

    event = parsedBody?.event;
    reference = parsedBody?.data?.reference;

    console.log("🔔 Webhook received:", {
      event: event,
      reference: reference,
      timeStamp: new Date().toISOString(),
    });

    try {
      // Verify webhook signature
      const secret = process.env.PAYSTACK_SECRET_KEY;
      if (!secret) {
        console.error("❌ PAYSTACK_SECRET_KEY not configured");
        return res.status(500).json({
          success: false,
          message: "Webhook secret not configured",
        });
      }

      const hash = crypto
        .createHmac("sha512", secret)
        .update(rawBody)
        .digest("hex");

      const signature = req.headers["x-paystack-signature"];

      if (hash !== signature) {
        console.error("❌ Invalid webhook signature");
        return res.status(400).json({
          success: false,
          message: "Invalid signature",
        });
      }

      const { data } = parsedBody;

      // log the event being processed
      console.log(
        `Processing webhook event: ${event} for reference: ${reference}`
      );

      switch (event) {
        case "charge.success":
          await handleSuccessfulPayment(data);
          console.log("✅ Successfully processed charge.success");
          break;

        case "charge.failed":
          await handleFailedPayment(data);
          console.log("❌ Successfully processed charge.failed");
          break;

        default:
          console.log(`Unhandled webhook event: ${event}`);
      }

      res.status(200).json({
        success: true,
        message: `Webhook ${event} processed successfully`,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Webhook processing error:", {
        error: err.message,
        stack: err.stack,
        event: event,
        reference: reference,
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Successful payment handler
export const handleSuccessfulPayment = async (data) => {
  try {
    const { reference, channel, amount, customer } = data;

    console.log("Processing successful payment:", {
      reference,
      channel,
      amount: amount / 100, // Convert from kobo to naira
      customer_email: customer?.email,
    });

    // Update order status only if it's still pending
    const updateQuery = `
            UPDATE orders
            SET
                status = 'paid',
                payment_method = $1,
                updated_at = now()
            WHERE payment_ref = $2 AND status = 'pending'
            RETURNING *
        `;

    const result = await db.query(updateQuery, [channel, reference]);

    if (result.rows.length > 0) {
      const order = result.rows[0];

      console.log("Order updated:", {
        order_id: order.id,
        user_id: order.user_id,
        previous_status: "pending",
        new_status: order.status,
      });

      // Only clear cart if order was actually updated (was pending)
      // This prevents clearing cart if user already verified payment
      const cartClearResult = await db.query(
        `DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = $1) AND EXISTS (SELECT 1 FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = $1))`,
        [order.user_id]
      );

      if (cartClearResult.rowCount > 0) {
        console.log(
          `Cleared ${cartClearResult.rowCount} items from cart for user ${order.user_id}`
        );
      } else {
        console.log("Cart was alredy empty or cleared");
      }

      // Log the payment transaction for audit trail
      await db.query(
        `INSERT INTO payment_logs (order_id, payment_reference, status, amount, payment_method, processed_by, gateway_response, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (payment_reference) DO NOTHING`,
        [
          order.id,
          reference,
          "paid",
          amount / 100, // Convert from kobo to naira
          channel,
          "webhook",
          JSON.stringify(data.gateway_response) || "Payment successful",
        ]
      );

      // Update Product Inventory
      try {
        await updateProductInventory(order.id);
        console.log("Inventory updated successfully");
      } catch (inventoryError) {
        console.log("Inventory update failed:", inventoryError.message);
      }
    } else {
      console.log("No pending order found for reference:", reference);
      console.log("This might mean payment was already verified by user");
    }
  } catch (err) {
    console.error("Error processing successful payment:", {
      error: err.message,
      stack: err.stack,
    });
  }
};

// Failed payment handler
export const handleFailedPayment = async (data) => {
  try {
    const { reference, gateway_response, customer } = data;

    console.log(" ❌ Processing failed payment:", {
      reference,
      reason: gateway_response,
      customer_email: customer?.email,
    });

    // Update order status to failed only if it's still pending
    const updateQuery = `
            UPDATE orders
            SET
                status = 'failed',
                updated_at = now()
            WHERE payment_ref = $1 AND status = 'pending'
            RETURNING *
        `;

    const result = await db.query(updateQuery, [reference]);

    if (result.rows.length > 0) {
      const order = result.rows[0];
      console.log(`Order ${order.id} marked as failed`);

      // Log the failed payment
      await db.query(
        `INSERT INTO payment_logs (order_id, payment_reference, status, failure_reason, processed_by, created_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (payment_reference) DO NOTHING`,
        [order.id, reference, "failed", gateway_response, "webhook"]
      );
    } else {
      console.log(
        "No pending order found for failed payment reference:",
        reference
      );
    }
  } catch (err) {
    console.error("Error processing failed payment:", {
      error: err.message,
      stack: err.stack,
    });
  }
};

// Update product inventory
export const updateProductInventory = async (orderId) => {
  try {
    console.log(`Updating inventory for ORDER ID: ${orderId}`);

    // Get order items
    const orderItemsQuery = `
            SELECT
                oi.product_id,
                oi.quantity as ordered_quantity,
                p.name as product_name,
                p.inventory_qty as current_stock
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = $1
        `;

    const orderItemsResult = await db.query(orderItemsQuery, [orderId]);

    if (orderItemsResult.rows.length === 0) {
      console.log(`No order items found for ORDER ID: ${orderId}`);
      return;
    }

    for (const item of orderItemsResult.rows) {
      const { product_id, ordered_quantity, product_name, current_stock } =
        item;
      const newStockQuantity = Math.max(0, current_stock - ordered_quantity);

      await db.query(
        `UPDATE products
        SET inventory_qty = $1, updated_at = now()
        WHERE id = $2`,
        [newStockQuantity, product_id]
      );

      console.log(
        `Updated inventory for ${product_name}: ${current_stock} -> ${newStockQuantity}`
      );

      // Update product status if it goes out of stock
      if (newStockQuantity === 0) {
        await db.query(
          `UPDATE products SET status = 'out_of_stock' WHERE id = $1`,
          [product_id]
        );
        console.log(`Product ${product_name} is now out of stock`);
      }
    }

    console.log(`Updated inventory successfully for order ${orderId}`);
  } catch (err) {
    console.error("Error updating product inventory:", {
      error: err.message,
      stack: err.stack,
      orderId: orderId,
    });
  }
};

// Get payment status
export const getPaymentStatus = async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    // Input validation
    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference is required",
      });
    }

    // check if user is authenticated
    if (!userId) {
        return res.status(401).json({
            success: false,
            message: "Authentication required"
        });
    }

    let query = `
            SELECT
                o.id,
                o.status,
                o.payment_method,
                o.total,
                o.placed_at,
                o.updated_at,
                o.payment_ref,
                u.email as customer_email,
                COUNT (oi.id) as item_count
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            LEFT JOIN order_items oi ON o.id = oi.order_id
            WHERE o.payment_ref =$1
        `;

    const queryParams = [reference];

    // Regular users can only see their own orders, admins can see any order
    if (userRole !== "admin") {
      query += " AND o.user_id = $2";
      queryParams.push(userId);
    }

    query += " GROUP BY o.id, u.email ORDER BY o.placed_at DESC";

    const result = await db.query(query, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment reference not found or access denied",
      });
    }

    const orderData = result.rows[0];

    // Get payment logs for this reference
    const logsQuery = `
            SELECT
                status,
                processed_by,
                created_at,
                failure_reason,
                gateway_response
            FROM payment_logs
            WHERE payment_reference = $1
            ORDER BY created_at DESC
            LIMIT 10
        `;

    const logsResult = await db.query(logsQuery, [reference]);

    // Get order items details
    const itemsQuery = `
      SELECT
        oi.quantity,
        oi.price,
        p.name as product_name,
        p.id as product_id
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `;

    const itemsResult = await db.query(itemsQuery, [orderData.id]);

    // Set cache control headers
    if (orderData.status === "paid") {
      res.set("Cache-Control", "public, max-age=86400"); // 24 hours
    } else {
      res.set("Cache-Control", "no-cache"); // Pending orders should not be cached
    }

    res.status(200).json({
      success: true,
      data: {
        ...orderData,
        items: itemsResult.rows,
        payment_logs: logsResult.rows,
        last_updated: new Date().toISOString()
      },
    });
  } catch (err) {
    console.error("Error getting payment status:", err);
    res.status(500).json({
      success: false,
      message: "Failed to get payment status",
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Internal server error",
    });
  }
};

// Test webhook endpoint for development
export const testWebhook = async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({
      success: false,
      message: "Test webhook no available in production",
    });
  }

  try {
    const { reference, event = "charge.success" } = req.body;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference is required",
      });
    }

    // Check if order exists
    const orderResult = await db.query(
      "SELECT * FROM orders WHERE payment_ref = $1",
      [reference]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found for this reference",
      });
    }

    // Simulate webhook data
    const testData = {
      event,
      data: {
        reference,
        status: event === "charge.success" ? "success" : "failed",
        amount: 100 * 100, // Convert from naira to kobo
        channel: "card",
        gateway_response:
          event === "charge.failed" ? "Insufficient funds" : "Approved",
        customer: {
          email: "test@example.com",
        },
      },
    };

    console.log("Testing webhook with data:", testData);

    if (event === "charge.success") {
      await handleSuccessfulPayment(testData);
    } else {
      await handleFailedPayment(testData);
    }

    res.json({
      success: true,
      message: `Test webhook ${event} processed successfully`,
      data: testData,
    });
  } catch (err) {
    console.error("Error testing webhook:", err);
    res.status(500).json({
      success: false,
      message: "Test webhook failed",
      error: err.message,
    });
  }
};
