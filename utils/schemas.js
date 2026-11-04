import { z } from "zod";
import { isValidUuid } from "./validators.js";

const id = z.string().refine(isValidUuid, "Must be a valid id");
const password = z.string().min(6, "Password must be at least 6 characters long");
const cartQuantity = z.coerce
  .number()
  .int("Quantity must be a whole number")
  .min(1, "Quantity must be greater than 0")
  .max(99, "Quantity cannot be more than 99");

const passwordsMatch = {
  check: (data) => data.password === data.confirmPassword,
  error: { message: "Passwords do not match", path: ["confirmPassword"] },
};

export const registerSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    email: z.email(),
    password,
    confirmPassword: z.string(),
  })
  .refine(passwordsMatch.check, passwordsMatch.error);

export const loginSchema = z.object({
  email: z.string().min(1, "Email is required"),
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({ email: z.email() });

export const resetPasswordSchema = z
  .object({ password, confirmPassword: z.string() })
  .refine(passwordsMatch.check, passwordsMatch.error);

export const updateProfileSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters long").optional(),
  email: z.email().optional(),
});

export const addShippingAddressSchema = z.object({
  line1: z.string(),
  line2: z.string().nullish(),
  city: z.string(),
  state: z.string().nullish(),
  postal_code: z.string(),
  country: z.string(),
  phone: z.string(),
});

export const addToCartSchema = z.object({ productId: id, quantity: cartQuantity });

export const updateCartItemSchema = z.object({ quantity: cartQuantity });

export const createOrderSchema = z.object({ shipping_address_id: id });

export const updateOrderStatusSchema = z.object({
  status: z.enum(["processing", "shipped", "delivered", "cancelled"]),
  notes: z.string().max(1000).optional(),
});

export const verifyPaymentSchema = z.object({ reference: z.string().min(1) });

// Other fields are left as they are: the controller converts and checks them
export const updateProductSchema = z.looseObject({
  status: z.enum(["active", "inactive", "out_of_stock"]).optional(),
});

export const paymentLogsQuerySchema = z.looseObject({
  order_id: id.optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).optional(),
});
