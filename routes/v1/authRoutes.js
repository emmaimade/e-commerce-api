import express from "express";
import {
  register,
  login,
  forgotPassword,
  resetPassword,
  showResetPasswordForm,
  logout,
  verifyEmail,
  resendVerification,
} from "../../controllers/v1/authController.js";

import {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  resendVerificationLimiter,
} from "../../middleware/rateLimit.js";
import { auth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../../utils/schemas.js";

const router = express.Router();

router.post("/register", registerLimiter, validate({ body: registerSchema }), register);
router.get("/verify-email/:token", verifyEmail);
router.post("/resend-verification", resendVerificationLimiter, validate({ body: forgotPasswordSchema }), resendVerification);
router.post("/login", loginLimiter, validate({ body: loginSchema }), login);
router.post("/logout", auth, logout);
router.post("/forgot-password", forgotPasswordLimiter, validate({ body: forgotPasswordSchema }), forgotPassword);
router.get("/reset-password/:token", showResetPasswordForm);
router.post("/reset-password/:token", resetPasswordLimiter, validate({ body: resetPasswordSchema }), resetPassword);

export default router;
