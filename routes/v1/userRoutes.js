import express from "express";
import {
  getUser,
  register,
  login,
  updateUser,
} from "../../controllers/v1/userController.js";
import { auth } from "../../middleware/auth.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", auth, getUser);
router.patch("/update", auth, updateUser);

export default router;
