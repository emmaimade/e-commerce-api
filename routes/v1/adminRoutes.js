import express from "express";
import { adminAuth } from "../../middleware/auth.js";
import {
  adminGetUser,
  adminGetUsers,
  getOrderAdmin,
  getOrdersAdmin,
  verifyPaymentAdmin,
  updateOrderStatus,
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
const router = express.Router();

// USERS
router.get("/users", adminAuth, adminGetUsers);
router.get("/users/:id", adminAuth, adminGetUser);

// PRODUCTS
router.get("/products/", adminAuth, getProducts);
router.get("/products/:id", adminAuth, getProduct);
router.post("/products/", upload.array("images", 5), adminAuth, addProduct);
router.patch("/products/:id", upload.array("images", 5), adminAuth, updateProduct);
router.patch("/products/:id/images", adminAuth, deleteProductImage);
router.delete("/products/:id", adminAuth, deleteProduct);

// ORDERS
router.get("/orders/", adminAuth, getOrdersAdmin);
router.get("/orders/:id", adminAuth, getOrderAdmin);
router.post("/orders/payment/verify/", adminAuth, verifyPaymentAdmin);
router.put("/orders/:id/status", adminAuth, updateOrderStatus);

export default router;
