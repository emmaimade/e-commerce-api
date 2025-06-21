import db from "../../config/db.js";
import crypto from "crypto";

// webhook handler
export const handleWebhook = async (req, res) => {
  try {
    console.log("🔔 Webhook received:", {
      event: req.body?.event,
      reference: req.body?.data?.reference,
      timeStamp: new Date().toISOString(),
    });

    try {
      // verify webhook signature
      const secret = process.env.PAYSTACK_WEBHOOK_SECRET;

      if (!secret) {
        console.error("❌ PAYSTACK_WEBHOOK_SECRET not configured");
        return res.status(500).json({
          success: false,
          message: "Webhook secret not configured",
        });
      }

      const hash = crypto
        .createHmac("sha512", secret)
        .update(JSON.stringify(req.body))
        .digest("hex");

      const signature = req.headers["x-paystack-signature"];

      if (hash !== signature) {
        console.error("❌ Invalid webhook signature");
        return res.status(400).json({
          success: false,
          message: "Invalid signature",
        });
      }

      const { event, data } = req.body;

      // log the event being processed
      console.log(
        `Processing webhook event: ${event} for reference: ${data?.reference}`
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
      });
    } catch (err) {
      console.error("Webhook processing error:", {
        error: err.message,
        stack: err.stack,
        body: req.body,
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
