import express from "express";
import {
  getProducts,
  getProduct,
} from "../../controllers/v1/productController.js";
import { auth } from "../../middleware/auth.js";

import { validateUuidParam } from "../../middleware/validate.js";

const router = express.Router();

router.param("id", validateUuidParam);

router.get("/", auth, getProducts);
router.get("/:id", auth, getProduct);

export default router;
