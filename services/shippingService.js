import parsePhoneNumber from "libphonenumber-js";
import { getCode } from "country-list";
import db from "../config/db.js";
import { HttpError } from "../utils/httpError.js";
import { FOREIGN_KEY_VIOLATION } from "../utils/validators.js";

const INVALID_COUNTRY = "Invalid country. Please use full country name.";

const formatPhone = (phone, countryCode) => {
  let phoneNumber;

  try {
    phoneNumber = parsePhoneNumber(phone, countryCode);
  } catch {
    throw new HttpError(400, "Invalid phone number format");
  }

  if (!phoneNumber) {
    throw new HttpError(400, "Invalid phone number format");
  }

  if (!phoneNumber.isValid()) {
    throw new HttpError(400, "Invalid phone number for selected country");
  }

  return phoneNumber.format("E.164");
};

const checkLengths = ({ line1, city, postal_code }) => {
  if (line1 !== undefined && line1.length < 3) {
    throw new HttpError(400, "Address line 1 must be at least 3 characters long");
  }

  if (city !== undefined && city.length < 2) {
    throw new HttpError(400, "City must be at least 2 characters long");
  }

  if (postal_code !== undefined && postal_code.length < 3) {
    throw new HttpError(400, "Postal code must be at least 3 characters long");
  }
};

const phoneWarning = (phone, countryName) => ({
  title: "Phone number compatibility warning",
  message: `Your current phone number (${phone}) may not be compatible with ${countryName}.`,
  impacts: [
    "International calling costs for delivery notifications",
    `Inability to receive local SMS in ${countryName}`,
    "Delivery issues if courier needs to contact you",
  ],
  recommendation: "Consider updating your phone number for better delivery experience.",
});

// A warning when the saved phone may not work in the address's new country
const checkPhoneForCountry = (phone, countryCode, countryName) => {
  const phoneNumber = parsePhoneNumber(phone, countryCode);

  return phoneNumber?.country === countryCode ? null : phoneWarning(phone, countryName);
};

export const addAddress = async (userId, { line1, line2, city, state, postal_code, country, phone }) => {
  if (!line1 || !city || !postal_code || !country || !phone) {
    throw new HttpError(400, "All fields are required");
  }

  const code = getCode(country);

  if (!code) {
    throw new HttpError(400, INVALID_COUNTRY);
  }

  const formattedPhone = formatPhone(phone, code);
  const fields = { line1: line1.trim(), city: city.trim(), postal_code: postal_code.trim() };

  checkLengths(fields);

  const result = await db.query(
    `INSERT INTO addresses (user_id, line1, line2, city, state, postal_code, country, phone)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      userId,
      fields.line1,
      line2?.trim() || null,
      fields.city,
      state?.trim() || null,
      fields.postal_code.toUpperCase(),
      code,
      formattedPhone,
    ]
  );

  return result.rows[0];
};

export const listAddresses = async (userId) => {
  const result = await db.query("SELECT * FROM addresses WHERE user_id = $1", [userId]);
  return result.rows;
};

export const getAddress = async (addressId, userId) => {
  const result = await db.query(
    "SELECT * FROM addresses WHERE id = $1 AND user_id = $2",
    [addressId, userId]
  );

  if (result.rows.length === 0) {
    throw new HttpError(404, "Shipping address not found");
  }

  return result.rows[0];
};

export const updateAddress = async (addressId, userId, updates) => {
  const existing = await getAddress(addressId, userId);

  const allowedFields = ["line1", "line2", "city", "state", "postal_code", "country", "phone"];
  const allowedUpdates = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined && value !== null && String(value).trim() !== "") {
      allowedUpdates[key] = String(value).trim();
    }
  }

  let countryCode = existing.country;
  let warning = null;

  if (allowedUpdates.country) {
    const countryName = allowedUpdates.country;
    countryCode = getCode(countryName);

    if (!countryCode) {
      throw new HttpError(400, INVALID_COUNTRY);
    }

    if (!allowedUpdates.phone) {
      warning = checkPhoneForCountry(existing.phone, countryCode, countryName);
    }

    allowedUpdates.country = countryCode;
  }

  if (allowedUpdates.phone) {
    allowedUpdates.phone = formatPhone(allowedUpdates.phone, countryCode);
  }

  checkLengths(allowedUpdates);

  if (allowedUpdates.postal_code) {
    allowedUpdates.postal_code = allowedUpdates.postal_code.toUpperCase();
  }

  const fields = Object.keys(allowedUpdates);

  if (fields.length === 0) {
    throw new HttpError(400, "No fields to update");
  }

  const setClause = fields.map((field, index) => `${field} = $${index + 1}`).join(", ");

  const result = await db.query(
    `UPDATE addresses SET ${setClause}, updated_at = NOW()
    WHERE id = $${fields.length + 1} AND user_id = $${fields.length + 2}
    RETURNING *`,
    [...Object.values(allowedUpdates), addressId, userId]
  );

  return { address: result.rows[0], warning };
};

export const deleteAddress = async (addressId, userId) => {
  try {
    const result = await db.query(
      "DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING *",
      [addressId, userId]
    );

    if (result.rows.length === 0) {
      throw new HttpError(404, "Shipping address not found");
    }

    return result.rows[0];
  } catch (err) {
    if (err.code === FOREIGN_KEY_VIOLATION) {
      throw new HttpError(409, "This address is used by an order and can't be deleted");
    }

    throw err;
  }
};
