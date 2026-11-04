import * as paymentService from "../../services/paymentService.js";
import { isValidWebhookSignature } from "../../services/paystackService.js";
import { paymentStatusPage } from "../../views/pages.js";

// Paystack calls this, so nothing in the body is trusted until the signature
// checks out. A failure while processing reaches Paystack as a 500, and it retries.
export const handleWebhook = async (req, res) => {
  if (!isValidWebhookSignature(req.body, req.headers["x-paystack-signature"])) {
    return res.status(400).json({
      success: false,
      message: "Invalid signature",
    });
  }

  let payload;

  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON body",
    });
  }

  await paymentService.processWebhookEvent(payload);

  res.status(200).json({
    success: true,
    message: `Webhook ${payload.event} processed successfully`,
    timestamp: new Date().toISOString(),
  });
};

// Landing page after Paystack checkout. Display only: the webhook confirms payments
export const paymentCallback = async (req, res) => {
  const paid = await paymentService.isOrderPaid(req.query.reference);

  res.type("html").send(paymentStatusPage({ paid }));
};

export const getPaymentStatus = async (req, res) => {
  const data = await paymentService.getCustomerPaymentStatus(req.params.reference, req.user.id);

  // Payment details are private and change as webhooks arrive
  res.set("Cache-Control", "private, no-store");

  res.status(200).json({
    success: true,
    data,
  });
};

// Test webhook endpoint for development
export const testWebhook = async (req, res) => {
  // Opt-in: only enabled when NODE_ENV is explicitly set to a non-production value
  if (!["development", "test"].includes(process.env.NODE_ENV)) {
    return res.status(403).json({
      success: false,
      message: "Test webhook is only available in development",
    });
  }

  const { reference, event = "charge.success" } = req.body;

  if (!reference) {
    return res.status(400).json({
      success: false,
      message: "Payment reference is required",
    });
  }

  const data = await paymentService.simulateWebhook(reference, event);

  res.json({
    success: true,
    message: `Test webhook ${event} processed successfully`,
    data,
  });
};
