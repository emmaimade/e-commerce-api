import multer from "multer";
import { HttpError } from "../utils/httpError.js";

const uploadErrorMessages = {
  LIMIT_FILE_SIZE: "File too large. Maximum size 5MB.",
  LIMIT_FILE_COUNT: "Too many files. Maximum is 5 files",
  LIMIT_UNEXPECTED_FILE: "Too many files. Maximum is 5 files",
};

// Must stay last in the middleware chain. Internal details are logged, never sent to clients.
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({
      success: false,
      message: err.message,
      ...err.details,
    });
  }

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: uploadErrorMessages[err.code] || "Invalid file upload",
    });
  }

  // Body parsing failures, such as malformed JSON or an oversized request
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({
      success: false,
      message: err.type === "entity.parse.failed" ? "Request body is not valid JSON" : err.message,
    });
  }

  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};
