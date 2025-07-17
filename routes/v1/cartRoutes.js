import express from "express";
import {
  addToCart,
  getCart,
  updateItemQty,
  deleteItem,
  clearCart
} from "../../controllers/v1/cartController.js";
import { auth } from "../../middleware/auth.js";

const router = express.Router();

router.post("/", auth, addToCart);
router.get("/", auth, getCart);
router.patch("/:id", auth, updateItemQty);
router.delete("/:id", auth, deleteItem);
router.delete("/", auth, clearCart);

export default router;
