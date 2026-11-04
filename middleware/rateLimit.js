import rateLimit from "express-rate-limit";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

const limiter = (options) =>
  rateLimit({
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      success: false,
      message: "Too many requests, please try again later",
    },
    ...options,
  });

// Successful logins don't count, so only failed attempts use up the limit
export const loginLimiter = limiter({
  windowMs: FIFTEEN_MINUTES,
  limit: 10,
  skipSuccessfulRequests: true,
});

export const registerLimiter = limiter({ windowMs: ONE_HOUR, limit: 10 });
export const resendVerificationLimiter = limiter({ windowMs: ONE_HOUR, limit: 5 });
export const forgotPasswordLimiter = limiter({ windowMs: ONE_HOUR, limit: 5 });
export const resetPasswordLimiter = limiter({ windowMs: FIFTEEN_MINUTES, limit: 10 });
