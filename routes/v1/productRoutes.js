import express from "express";
import {
  getProducts,
  getProduct,
} from "../../controllers/v1/productController.js";
import { auth } from "../../middleware/auth.js";

const router = express.Router();

router.get("/", auth, getProducts);
router.get("/:id", auth, getProduct);

export default router;
