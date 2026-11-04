import express from "express";
import {
  addToCart,
  getCart,
  updateItemQty,
  deleteItem,
  clearCart
} from "../../controllers/v1/cartController.js";
import { auth } from "../../middleware/auth.js";

import { validate, validateUuidParam } from "../../middleware/validate.js";
import { addToCartSchema, updateCartItemSchema } from "../../utils/schemas.js";

const router = express.Router();

router.param("id", validateUuidParam);

router.post("/", auth, validate({ body: addToCartSchema }), addToCart);
router.get("/", auth, getCart);
router.patch("/:id", auth, validate({ body: updateCartItemSchema }), updateItemQty);
router.delete("/:id", auth, deleteItem);
router.delete("/", auth, clearCart);

export default router;
