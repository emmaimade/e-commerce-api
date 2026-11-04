import express from "express";
import {
  register,
  login,
  forgotPassword,
  resetPassword,
  showResetPasswordForm,
} from "../../controllers/v1/authController.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.get("/reset-password/:token", showResetPasswordForm);
router.post("/reset-password/:token", resetPassword);

export default router;
