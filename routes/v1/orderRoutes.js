import express from "express";
import {
  createOrder,
  verifyPayment,
  getOrders,
  getOrder,
  getOrderHistory,
} from "../../controllers/v1/orderController.js";
import { auth } from "../../middleware/auth.js";

const router = express.Router();

router.post("/", auth, createOrder);
router.get("/payment/verify/:reference", auth, verifyPayment);
router.get("/", auth, getOrders);
router.get("/:id", auth, getOrder);
router.get("/:orderId/history", auth, getOrderHistory);

export default router;
