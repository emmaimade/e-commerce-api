import express from "express";
import {
  getUser,
  register,
  login,
  updateUser,
  forgotPassword,
  resetPassword,
} from "../../controllers/v1/userController.js";
import { auth } from "../../middleware/auth.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.get("/profile", auth, getUser);
router.patch("/update", auth, updateUser);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);

export default router;
