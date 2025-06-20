import db from "../../config/db.js";

export const getProducts = async (req, res) => {
  try {
    const products = await db.query("SELECT * FROM products");
    if (products.rows.length === 0) {
      return res.status(404).json({ message: "No products found" });
    }
    res.status(200).json({ products: products.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getProduct = async (req, res) => {
  try {
    const productId = req.params.id;

    const product = await db.query("SELECT * FROM products WHERE id = $1", [
      productId,
    ]);
    if (product.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.status(200).json({ product: product.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ========================================
// ADMIN-ONLY PRODUCT CONTROLLERS
// ========================================

export const addProduct = async (req, res) => {
  try {
    const { name, price, inventory_qty } = req.body;

    if (!name || !price || !inventory_qty) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (isNaN(price) || isNaN(inventory_qty)) {
      return res
        .status(400)
        .json({ message: "Price and inventory must be numbers" });
    }

    if (price <= 0 || inventory_qty <= 0) {
      return res
        .status(400)
        .json({ message: "Price and inventory must be greater than 0" });
    }

    const newProduct = await db.query(
      "INSERT INTO products (name, price, inventory_qty) VALUES ($1, $2, $3) RETURNING *",
      [name, price, inventory_qty]
    );

    res.status(201).json({
      message: "Product added successfully",
      product: newProduct.rows[0],
    });
  } catch (err) {
    console.log("Error adding product", err);
    res.status(500).json({ error: err.message });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const updates = req.body;

    // define allowed fields
    const allowedFields = [
      "name",
      "price",
      "description",
      "inventory_qty",
      "image_url",
    ];
    const allowedUpdates = {};

    // filter only allowed fields
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && value !== undefined && value !== "") {
        allowedUpdates[key] = value;
      }
    }

    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    // checks if price is a number
    if (allowedUpdates.price) {
      if (isNaN(allowedUpdates.price)) {
        return res.status(400).json({ message: "Price must be a number" });
      }
      // checks if price is greater than one
      if (allowedUpdates.price <= 0) {
        return res
          .status(400)
          .json({ message: "Price must be greater than 0" });
      }
    }

    // check if inventory_qty is a number
    if (allowedUpdates.inventory_qty) {
      if (isNaN(allowedUpdates.inventory_qty)) {
        return res.status(400).json({ message: "Inventory must be a number" });
      }
      // checks if inventory_qty is greater than one
      if (allowedUpdates.inventory_qty <= 0) {
        return res
          .status(400)
          .json({ message: "Inventory must be greater than 0" });
      }
    }

    // dynamic sql query
    const fields = Object.keys(allowedUpdates);
    const values = Object.values(allowedUpdates);
    const setClause = fields
      .map((field, index) => `${field} = $${index + 1}`)
      .join(", ");

    const query = `UPDATE products SET ${setClause}, updated_at = NOW() WHERE id = $${
      fields.length + 1
    } RETURNING *`;

    // update product
    const result = await db.query(query, [...values, productId]);

    res.status(200).json({
      message: "Product updated successfully",
      product: result.rows[0],
    });
  } catch (err) {
    console.log("Error updating product", err);
    res.status(500).json({ error: err.message });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const productId = req.params.id;

    const product = await db.query("SELECT * FROM products WHERE id = $1", [
      productId,
    ]);

    if (product.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    await db.query("DELETE FROM products WHERE id = $1", [productId]);

    res.status(200).json({ message: "Product deleted successfully" });
  } catch (err) {
    console.log("Error deleting product", err);
    res.status(500).json({ error: err.message });
  }
};
