import express from "express";
import {
  createOrder,
  verifyPayment,
  getOrders,
  getOrder,
} from "../../controllers/v1/orderController.js";
import { auth } from "../../middleware/auth.js";

const router = express.Router();

router.post("/", auth, createOrder);
router.post("/payment/verify", auth, verifyPayment);
router.get("/", auth, getOrders);
router.get("/:id", auth, getOrder);

export default router;
