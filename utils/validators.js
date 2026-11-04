const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isValidUuid = (value) =>
  typeof value === "string" && UUID_PATTERN.test(value);

// Postgres error code for a row still referenced by another table
export const FOREIGN_KEY_VIOLATION = "23503";
