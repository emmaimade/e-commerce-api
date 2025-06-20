import express from "express";
import { adminAuth } from "../../middleware/auth.js";
import {
  adminGetUser,
  adminGetUsers,
} from "../../controllers/v1/userController.js";
import {
  getProducts,
  getProduct,
  addProduct,
  updateProduct,
  deleteProduct,
} from "../../controllers/v1/productController.js";
import {
  getOrderAdmin,
  getOrdersAdmin,
  verifyPaymentAdmin,
} from "../../controllers/v1/orderController.js";
const router = express.Router();

// USERS
router.get("/users", adminAuth, adminGetUsers);
router.get("/users/:id", adminAuth, adminGetUser);

// PRODUCTS
router.get("/products/", adminAuth, getProducts);
router.get("/products/:id", adminAuth, getProduct);
router.post("products/", adminAuth, addProduct);
router.patch("/products/:id", adminAuth, updateProduct);
router.delete("/products/:id", adminAuth, deleteProduct);

// ORDERS
router.get("/orders/", adminAuth, getOrdersAdmin);
router.get("/orders/:id", adminAuth, getOrderAdmin);
router.get("/orders/payment/:reference", adminAuth, verifyPaymentAdmin);

export default router;
