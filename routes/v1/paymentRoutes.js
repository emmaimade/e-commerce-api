import express from "express";
import {
  handleWebhook,
  getPaymentStatus,
  testWebhook,
  paymentCallback,
} from "../../controllers/v1/paymentController.js";

import { auth, adminAuth } from "../../middleware/auth.js";

const router = express.Router();

// Webhook endpoint - NO authentication middleware (Paystack calls this)
router.post("/webhook", handleWebhook);

// Paystack sends the customer here after checkout - NO authentication (browser redirect)
router.get("/callback", paymentCallback);

// Get payment status
router.get("/status/:reference", auth, getPaymentStatus);

// Test webhook - only available in development
router.post("/test-webhook", adminAuth, testWebhook);

export default router;