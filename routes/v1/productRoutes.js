import express from "express";
import {
  getProducts,
  getProduct,
  addProduct,
  updateProduct,
  deleteProduct,
} from "../../controllers/v1/productController.js";
import auth from "../../middleware/auth.js";

const router = express.Router();

router.get("/", getProducts);
router.get("/:id", getProduct);
router.post("/", auth, addProduct);
router.patch("/:id", auth, updateProduct);
router.delete("/:id", auth, deleteProduct);

export default router;
