import * as authService from "../../services/authService.js";
import { resetPasswordPage } from "../../views/pages.js";

export const register = async (req, res) => {
  const user = await authService.register(req.body);

  res.status(201).json({
    success: true,
    message: "User registered successfully",
    user,
  });
};

export const login = async (req, res) => {
  const token = await authService.login(req.body);

  res.status(200).json({
    success: true,
    message: "Login successful",
    token,
  });
};

export const logout = async (req, res) => {
  await authService.logoutEverywhere(req.user.id);

  res.status(200).json({
    success: true,
    message: "Logged out on all devices",
  });
};

export const forgotPassword = async (req, res) => {
  await authService.requestPasswordReset(req.body.email);

  res.status(200).json({
    success: true,
    message: "If an account exists for that email, a reset link has been sent",
  });
};

// The emailed link opens in a browser
export const showResetPasswordForm = (req, res) => {
  // The token is in the URL, so don't send it to other sites
  res.set("Referrer-Policy", "no-referrer");
  res.type("html").send(resetPasswordPage());
};

export const resetPassword = async (req, res) => {
  await authService.resetPassword(req.params.token, req.body.password);

  res.status(200).json({
    success: true,
    message: "Password reset successfully",
  });
};
