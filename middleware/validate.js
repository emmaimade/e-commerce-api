import { isValidUuid } from "../utils/validators.js";

const validationError = (res, errors) =>
  res.status(400).json({
    success: false,
    message: "Validation failed",
    errors,
  });

// Checks req.body and req.query against zod schemas. Parsed bodies replace
// req.body, so controllers get trimmed and converted values.
export const validate = ({ body, query }) => (req, res, next) => {
  if (query) {
    const result = query.safeParse(req.query);
    if (!result.success) return validationError(res, formatIssues(result.error));
  }

  if (body) {
    const result = body.safeParse(req.body ?? {});
    if (!result.success) return validationError(res, formatIssues(result.error));
    req.body = result.data;
  }

  next();
};

const formatIssues = (error) =>
  error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));

// For router.param, on routes for tables with numeric ids
export const validateIntegerParam = (req, res, next, value, name) => {
  if (!/^\d+$/.test(value)) {
    return validationError(res, [{ field: name, message: "Must be a valid id" }]);
  }

  next();
};

// For router.param: rejects route ids that aren't UUIDs before they reach the database
export const validateUuidParam = (req, res, next, value, name) => {
  if (!isValidUuid(value)) {
    return validationError(res, [{ field: name, message: "Must be a valid id" }]);
  }

  next();
};
