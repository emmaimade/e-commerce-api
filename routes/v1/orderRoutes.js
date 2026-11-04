import express from "express";
import {
  createOrder,
  verifyPayment,
  getOrders,
  getOrder,
  getOrderHistory,
  cancelOrder
} from "../../controllers/v1/orderController.js";
import { auth } from "../../middleware/auth.js";

import { validate, validateUuidParam } from "../../middleware/validate.js";
import { createOrderSchema } from "../../utils/schemas.js";

const router = express.Router();

router.param("id", validateUuidParam);
router.param("orderId", validateUuidParam);

router.post("/", auth, validate({ body: createOrderSchema }), createOrder);
router.get("/payment/verify/:reference", auth, verifyPayment);
router.get("/", auth, getOrders);
router.get("/:id", auth, getOrder);
router.get("/:orderId/history", auth, getOrderHistory);
router.delete("/:orderId", auth, cancelOrder);

export default router;
