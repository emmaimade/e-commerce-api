import express from "express";
import { adminAuth } from "../../middleware/auth.js";
import {
  adminGetUser,
  adminGetUsers,
  getOrderAdmin,
  getOrdersAdmin,
  verifyPaymentAdmin,
  updateOrderStatus,
  getPaymentStatusAdmin,
  getPaymentLogs,
  getPaymentAnalytics,
  addProduct,
  updateProduct,
  deleteProductImage,
  deleteProduct
} from "../../controllers/v1/adminController.js";
import {
  getProducts,
  getProduct,
} from "../../controllers/v1/productController.js";
import { upload } from "../../middleware/upload.js";
import { validate, validateUuidParam } from "../../middleware/validate.js";
import {
  updateProductSchema,
  updateOrderStatusSchema,
  verifyPaymentSchema,
  paymentLogsQuerySchema,
} from "../../utils/schemas.js";

const router = express.Router();

router.param("id", validateUuidParam);

// USERS
router.get("/users", adminAuth, adminGetUsers);
router.get("/users/:id", adminAuth, adminGetUser);

// PRODUCTS
router.get("/products/", adminAuth, getProducts);
router.get("/products/:id", adminAuth, getProduct);
router.post("/products/", adminAuth, upload.array("images", 5), addProduct);
router.patch("/products/:id", adminAuth, upload.array("images", 5), validate({ body: updateProductSchema }), updateProduct);
router.patch("/products/:id/images", adminAuth, deleteProductImage);
router.delete("/products/:id", adminAuth, deleteProduct);

// ORDERS
router.get("/orders/", adminAuth, getOrdersAdmin);
router.get("/orders/:id", adminAuth, getOrderAdmin);
router.post("/orders/payment/verify/", adminAuth, validate({ body: verifyPaymentSchema }), verifyPaymentAdmin);
router.put("/orders/:id/status", adminAuth, validate({ body: updateOrderStatusSchema }), updateOrderStatus);

// PAYMENTS
router.get("/payments/status/:reference", adminAuth, getPaymentStatusAdmin);
router.get("/payments/logs", adminAuth, validate({ query: paymentLogsQuerySchema }), getPaymentLogs);
router.get("/payments/analytics", adminAuth, getPaymentAnalytics);  

export default router;
