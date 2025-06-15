import express from "express";
import {
  addToCart,
  getCart,
  updateItemQty,
  deleteItem,
} from "../../controllers/v1/cartController.js";
import auth from "../../middleware/auth.js";

const router = express.Router();

router.post("/", auth, addToCart);
router.get("/", auth, getCart);
router.patch("/:id", auth, updateItemQty);
router.delete("/:id", auth, deleteItem);

export default router;
