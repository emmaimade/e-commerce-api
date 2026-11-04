import db from "../config/db.js";
import { HttpError } from "../utils/httpError.js";
import { FOREIGN_KEY_VIOLATION } from "../utils/validators.js";
import { deleteFromCloudinary, uploadMultipleToCloudinary } from "./imageService.js";

// The images column is JSONB, but older rows may hold it as a JSON string
const parseImages = (images) => {
  if (Array.isArray(images)) return images;
  if (typeof images !== "string") return [];

  try {
    const parsed = JSON.parse(images);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn("Failed to parse product images JSON");
    return [];
  }
};

const withImages = (product) => ({ ...product, images: parseImages(product.images) });

// image_urls arrives as an array, a JSON array string, or a single URL
const parseImageUrls = (imageUrls) => {
  let urls = [];

  if (typeof imageUrls === "string") {
    try {
      urls = JSON.parse(imageUrls);
    } catch {
      urls = [imageUrls];
    }
  } else if (Array.isArray(imageUrls)) {
    urls = imageUrls;
  }

  return urls.filter((url) => typeof url === "string" && url.trim() !== "");
};

const toImageRecord = (result, index, existingCount) => ({
  url: result.secure_url, // For displaying
  public_id: result.public_id, // For management
  width: result.width,
  height: result.height,
  format: result.format,
  is_primary: existingCount === 0 && index === 0, // First image is primary
  display_order: existingCount + index,
});

const removeUploadedImages = async (publicIds) => {
  for (const publicId of publicIds) {
    try {
      await deleteFromCloudinary(publicId);
    } catch (err) {
      console.error(`Failed to clean up image ${publicId}:`, err);
    }
  }
};

export const listProducts = async (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
  const offset = (page - 1) * limit;
  const { search, min_price, max_price, sort_by = "created_at", sort_order = "desc" } = query;

  const conditions = ["status = 'active'"];
  const params = [];

  if (search && search.trim()) {
    params.push(`%${search.trim()}%`);
    conditions.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
  }

  if (min_price && !isNaN(min_price)) {
    params.push(parseFloat(min_price));
    conditions.push(`price >= $${params.length}`);
  }

  if (max_price && !isNaN(max_price)) {
    params.push(parseFloat(max_price));
    conditions.push(`price <= $${params.length}`);
  }

  // Sort values go straight into the SQL, so only these are allowed
  const sortField = ["name", "price", "created_at", "updated_at"].includes(sort_by) ? sort_by : "created_at";
  const sortDirection = ["ASC", "DESC"].includes(sort_order.toUpperCase()) ? sort_order.toUpperCase() : "DESC";
  const whereClause = conditions.join(" AND ");

  const count = await db.query(`SELECT COUNT(*) as total FROM products WHERE ${whereClause}`, params);
  const totalProducts = parseInt(count.rows[0].total);

  const totalPages = Math.ceil(totalProducts / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  const result = await db.query(
    `SELECT * FROM products
    WHERE ${whereClause}
    ORDER BY ${sortField} ${sortDirection}
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return {
    products: result.rows.map(withImages),
    filters: {
      search: search || null,
      min_price: min_price || null,
      max_price: max_price || null,
      sort_by: sortField,
      sort_order: sortDirection,
    },
    pagination: {
      current_page: page,
      per_page: limit,
      total_items: totalProducts,
      total_pages: totalPages,
      has_next_page: hasNextPage,
      has_prev_page: hasPrevPage,
      next_page: hasNextPage ? page + 1 : null,
      prev_page: hasPrevPage ? page - 1 : null,
    },
  };
};

const findProduct = async (productId) => {
  const result = await db.query("SELECT * FROM products WHERE id = $1", [productId]);

  if (result.rows.length === 0) {
    throw new HttpError(404, "Product not found");
  }

  return withImages(result.rows[0]);
};

export const getProduct = findProduct;

export const createProduct = async ({ name, description, price, inventory_qty, image_urls }, files = []) => {
  if (!name || !description || !price || !inventory_qty) {
    throw new HttpError(400, "All fields are required");
  }

  const priceNum = parseInt(price);
  const inventoryNum = parseInt(inventory_qty);

  if (isNaN(priceNum) || isNaN(inventoryNum)) {
    throw new HttpError(400, "Price and inventory must be numbers");
  }

  if (priceNum <= 0 || inventoryNum <= 0) {
    throw new HttpError(400, "Price and inventory must be greater than 0");
  }

  const uploads = [...files, ...parseImageUrls(image_urls)];
  const uploaded = uploads.length > 0 ? await uploadMultipleToCloudinary(uploads, "products") : [];
  const images = uploaded.map((result, index) => toImageRecord(result, index, 0));

  const product = await db.query(
    `INSERT INTO products (name, description, price, inventory_qty, images)
    VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, description, priceNum, inventoryNum, JSON.stringify(images)]
  );

  return withImages(product.rows[0]);
};

export const updateProduct = async (productId, updates, files = []) => {
  const existing = await findProduct(productId);

  const allowedFields = ["name", "price", "description", "inventory_qty", "status"];
  const allowedUpdates = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined && value !== null && String(value).trim() !== "") {
      allowedUpdates[key] = String(value).trim();
    }
  }

  const imagesToUpload = [...files, ...parseImageUrls(updates.image_urls)];

  if (allowedUpdates.price) {
    if (isNaN(allowedUpdates.price)) {
      throw new HttpError(400, "Price must be a number");
    }

    if (allowedUpdates.price <= 0) {
      throw new HttpError(400, "Price must be greater than 0");
    }
  }

  // inventory_qty is a change to stock, positive or negative. It is applied
  // in the UPDATE below so it can't overwrite a concurrent reservation.
  let stockChange = null;

  if (allowedUpdates.inventory_qty) {
    stockChange = parseInt(allowedUpdates.inventory_qty);

    if (isNaN(stockChange)) {
      throw new HttpError(400, "Inventory must be a number");
    }

    delete allowedUpdates.inventory_qty;
  }

  if (Object.keys(allowedUpdates).length === 0 && stockChange === null && imagesToUpload.length === 0) {
    throw new HttpError(400, "No fields to update");
  }

  let uploadedPublicIds = [];

  if (imagesToUpload.length > 0) {
    let uploaded;

    try {
      uploaded = await uploadMultipleToCloudinary(imagesToUpload, "products");
    } catch (err) {
      console.error("Upload failed", err);
      throw new HttpError(500, "Failed to upload images");
    }

    uploadedPublicIds = uploaded.map((result) => result.public_id);

    const newImages = uploaded.map((result, index) => toImageRecord(result, index, existing.images.length));
    allowedUpdates.images = JSON.stringify([...existing.images, ...newImages]);
  }

  try {
    const params = Object.values(allowedUpdates);
    const setClauses = Object.keys(allowedUpdates).map((field, index) => `${field} = $${index + 1}`);
    let stockGuard = "";

    if (stockChange !== null) {
      params.push(stockChange);
      const change = `$${params.length}`;
      setClauses.push(`inventory_qty = inventory_qty + ${change}`);
      stockGuard = `AND inventory_qty + ${change} >= 0`;

      // A status sent by the admin wins; inactive products stay inactive
      if (!allowedUpdates.status) {
        setClauses.push(`status = CASE
          WHEN inventory_qty + ${change} = 0 THEN 'out_of_stock'
          WHEN status = 'out_of_stock' THEN 'active'
          ELSE status END`);
      }
    }

    params.push(productId);

    const result = await db.query(
      `UPDATE products SET ${setClauses.join(", ")}, updated_at = NOW()
      WHERE id = $${params.length} ${stockGuard} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      throw new HttpError(400, "Cannot reduce inventory below 0");
    }

    return withImages(result.rows[0]);
  } catch (err) {
    await removeUploadedImages(uploadedPublicIds);
    throw err;
  }
};

export const removeProductImage = async (productId, publicId) => {
  if (!publicId) {
    throw new HttpError(400, "Public ID is required");
  }

  const product = await findProduct(productId);
  const images = [...product.images];
  const imageIndex = images.findIndex((image) => image.public_id === publicId);

  if (imageIndex === -1) {
    throw new HttpError(404, "Image not found in product");
  }

  const [deletedImage] = images.splice(imageIndex, 1);

  if (deletedImage.is_primary && images.length > 0) {
    images[0].is_primary = true;
  }

  const reordered = images.map((image, index) => ({ ...image, display_order: index }));

  await deleteFromCloudinary(publicId);

  const updated = await db.query(
    "UPDATE products SET images = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [JSON.stringify(reordered), productId]
  );

  return { product: withImages(updated.rows[0]), deletedImage };
};

export const deleteProduct = async (productId) => {
  const product = await findProduct(productId);

  try {
    await db.query("DELETE FROM products WHERE id = $1", [productId]);
  } catch (err) {
    // Foreign keys keep order history intact
    if (err.code === FOREIGN_KEY_VIOLATION) {
      throw new HttpError(409, "This product is part of an order or cart and can't be deleted. Set its status to inactive instead.");
    }

    throw err;
  }

  await removeUploadedImages(product.images.map((image) => image.public_id).filter(Boolean));
};
