import axios from "axios";

import db from "../../config/db.js";
import { updateProductInventory } from "./paymentController.js";
import { uploadMultipleToCloudinary, deleteFromCloudinary } from "../../utils/cloudinaryUpload.js";


// ========================================
// USER CONTROLLERS
// ========================================

export const adminGetUsers = async (req, res) => {
  try {
    const users = await db.query("SELECT * FROM users");
    if (!users) {
      return res.status(404).json({ message: "No users found" });
    }
    res.status(200).json({ users: users.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const adminGetUser = async (req, res) => {
  try {
    const userId = req.params.id;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const user = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ user: user.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ========================================
// PRODUCT CONTROLLERS
// ========================================

export const addProduct = async (req, res) => {
  try {
    const { name, description, price, inventory_qty, image_urls } = req.body;
    let images = [];

    if (!name || !description || !price || !inventory_qty) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const priceNum = parseInt(price);
    const inventoryNum = parseInt(inventory_qty);

    if (isNaN(priceNum) || isNaN(inventoryNum)) {
      return res
        .status(400)
        .json({ message: "Price and inventory must be numbers" });
    }

    if (priceNum <= 0 || inventoryNum <= 0) {
      return res
        .status(400)
        .json({ message: "Price and inventory must be greater than 0" });
    }

    let uploadData = [];
    
    // Handle file uploads
    if (req.files && req.files.length > 0) {
      uploadData = [...uploadData, ...req.files];
    }

    // Handle URL uploads
    if (image_urls) {
      let urls = [];

      if (typeof image_urls === "string") {
        try {
          // Try to parse JSON as array
          urls = JSON.parse(image_urls)
        } catch {
          urls = [image_urls];
        }
      } else if (Array.isArray(image_urls)) {
        urls = image_urls;
      }

      // Validate URLs and Add to uploadData
      const validUrls = urls.filter(url => typeof url === "string" && url.trim() !== "");
      uploadData = [...uploadData, ...validUrls];
    }

    // Upload images to cloudinary
    if (uploadData.length > 0) {
      console.log(`Uploading ${uploadData.length} images to Cloudinary...`);
      const cloudinaryResult = await uploadMultipleToCloudinary(
        uploadData,
        "products"
      );

      images = cloudinaryResult.map((result, index) => ({
        url: result.secure_url, // For displaying
        public_id: result.public_id, // For management
        width: result.width,
        height: result.height,
        format: result.format,
        is_primary: index === 0, // First image is primary
        display_order: index,
      }));
    }
    console.log(typeof(images));

    const newProduct = await db.query(
      `INSERT INTO products (name, description, price, inventory_qty, images) 
      VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description, priceNum, inventoryNum, JSON.stringify(images)]
    );

    const product = newProduct.rows[0];
    // Convert image to array for response
    if (typeof product.images === "string") {
      product.images = JSON.parse(product.images);
    }

    res.status(201).json({
      success: true,
      message: "Product added successfully",
      product: product,
    });
  } catch (err) {
    console.log("Error adding product", err);
    res.status(500).json({ 
        success: false,
        message: "Error adding product",
        error: err.message
     });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const updates = req.body;

    // Get existing product to get current images
    const existingProduct = await db.query(
      "SELECT * FROM products WHERE id = $1",
      [productId]
    );

    if (existingProduct.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Define allowed fields
    const allowedFields = ["name", "price", "description", "inventory_qty"];
    const allowedUpdates = {};

    // Filter only allowed fields
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && value !== undefined && value !== "") {
        allowedUpdates[key] = value;
      }
    }

    let currentImages = [];
    try {
      const imageData = existingProduct.rows[0].images;

      if (imageData) {
        if (typeof imageData === "string") {
          currentImages = JSON.parse(imageData);
        } else if (Array.isArray(imageData)) {
          currentImages = imageData;
        } else {
          console.warn("Unexpected image data format:", typeof imageData);
          currentImages = [];
        }
      }

      // Check if currentImages is a proper array
      if (!Array.isArray(currentImages)) {
        console.warn('Current images is not an array after parsing, resetting to empty array')
        currentImages = [];
      }
    } catch (parseErr) {
      console.log("Failed to parse current images JSON:", parseErr);

      // Instead of just resetting, let's try to reload from database
      try {
        console.log("Attempting to reload product data from database...");
        const reloadResult = await db.query(
          "SELECT images FROM products WHERE id = $1",
          [productId]
        );

        if (reloadResult.rows.length > 0) {
          const reloadedImageData = reloadResult.rows[0].images;
          if (reloadedImageData && typeof reloadedImageData === "string") {
            currentImages = JSON.parse(reloadedImageData);
          }
        }
      } catch (reloadErr) {
        console.error("Failed to reload from database:", reloadErr);

        // Don't proceed with the update to avoid data loss
        return res.status(500).json({
          success: false,
          message:
            "Unable to retrieve current product images. Please try again.",
          error: "Image data corruption detected",
        });
      }
    }
    
    // Initialize images to upload
    // This will hold both file uploads and image URLs
    let imagesToUpload = [];

    // Handle image updates
    if (req.files && req.files.length > 0) {
      imagesToUpload = [...imagesToUpload, ...req.files];
    }

    // If image URLs are provided, handle them
    if (updates.image_urls) {
      let urls = [];

      if (typeof updates.image_urls === "string") {
        try {
          urls = JSON.parse(updates.image_urls);
        } catch {
          urls = [updates.image_urls];
        }
      } else if (Array.isArray(updates.image_urls)) {
          urls = updates.image_urls;
      }

      // Validate URLs and Add to imageToUpdate
      const validUrls = urls.filter(url => typeof url === "string" && url.trim() !== "");
      imagesToUpload = [...imagesToUpload, ...validUrls];
    }

    // Checks if price is a number
    if (allowedUpdates.price) {
      if (isNaN(allowedUpdates.price)) {
        return res.status(400).json({ message: "Price must be a number" });
      }
      // Checks if price is greater than one
      if (allowedUpdates.price <= 0) {
        return res
          .status(400)
          .json({ message: "Price must be greater than 0" });
      }
    }

    // Validate inventory
    if (allowedUpdates.inventory_qty) {
      // check if inventory_qty is a number
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

    // Check if there are any updates to make (including images)
    if (Object.keys(allowedUpdates).length === 0 && imagesToUpload.length === 0) {
      return res.status(400).json({ 
        success: false,
        message: "No fields to update" 
      });
    }

    let uploadedPublicIds = [];

    if (imagesToUpload.length > 0) {
      try {
        // Upload new images to cloudinary
        const cloudinaryResult = await uploadMultipleToCloudinary(
          imagesToUpload,
          "products"
        );

        // Extract public IDs from the upload results for potential cleanup on error
        uploadedPublicIds = cloudinaryResult.map((result) => result.public_id);

        const newImages = cloudinaryResult.map((result, index) => ({
          url: result.secure_url,
          public_id: result.public_id,
          width: result.width,
          height: result.height,
          format: result.format,
          is_primary: currentImages.length === 0 && index === 0,
          display_order: currentImages.length + index,
        }));

        // Combine existing and new images
        const updatedImages = [...currentImages, ...newImages];
        // Convert array to json string
        allowedUpdates.images = JSON.stringify(updatedImages);
      } catch (uploadErr) {
        console.error("Upload failed", uploadErr);
        return res.status(500).json({
          success: false,
          message: "Failed to  upload images",
          error: uploadErr.message,
        });
      }
    }
  
    // Database Update
    try {
      // Dynamic sql query
      const fields = Object.keys(allowedUpdates);
      const values = Object.values(allowedUpdates);
      const setClause = fields
        .map((field, index) => `${field} = $${index + 1}`)
        .join(", ");

      const query = `UPDATE products SET ${setClause}, updated_at = NOW() WHERE id = $${
        fields.length + 1
      } RETURNING *`;

      // Update product
      const result = await db.query(query, [...values, productId]);

      // Parse images back to array for response
      const updatedProduct = result.rows[0];
      if (updatedProduct.images && typeof updatedProduct.images === "string") {
        updatedProduct.images = JSON.parse(updatedProduct.images);
      }

      res.status(200).json({
        success: true,
        message: "Product updated successfully",
        product: updatedProduct,
      });
    } catch (dbErr) {
      console.error("Database update failed", dbErr);

      // If database update fails, clean up uploaded images
      if (uploadedPublicIds.length > 0) {
        // Delete uploaded images individually
        for (const publicId of uploadedPublicIds) {
          try {
            await deleteFromCloudinary(publicId);
            console.log(`Cleaned up Image: ${publicId}`);
          } catch (cleanupErr) {
            console.error(`Failed to cleanup image ${publicId}:`, cleanupErr);
          }
        }
      }
      res.status(500).json({
        success: false,
        message: "Database update failed",
        error: dbErr.message,
      });
    }
  } catch (err) {
    console.log("Error updating product", err);
    res.status(500).json({
        success: false,
        message: "Error updating product", 
        error: err.message 
    });
  }
};

export const deleteProductImage = async (req, res) => {
  try {
    const productId = req.params.id;
    const { publicId } = req.body;

    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: "Public ID is required",
      });
    }

    // Check if product exists
    const productResult = await db.query(
      "SELECT * FROM products WHERE id = $1",
      [productId]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const product = productResult.rows[0];

    // Parse images from product
    let images = [];
    try {
      const imageData = product.images;

      if (typeof imageData === "string") {
        images = JSON.parse(imageData);
      } else if (Array.isArray(imageData)) {
        images = imageData;
      } else {
        console.warn('Unexpected image data format:', typeof imageData);
        images = [];
      }

      // Check if images is a proper array
      if (!Array.isArray(images)) {
        console.warn('Images is not an array after parsing, resetting to empty array');
        images = [];
      }
    } catch (parseErr) {
      console.error("Failed to parse images JSON:", parseErr);
      return res.status(500).json({
        success: false,
        message: "Failed to parse images JSON",
        error: parseErr.message,
      });
    }

    // Find index of image to be deleted
    const imageIndex = images.findIndex((img) => img.public_id === publicId);

    if (imageIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Image not found in product",
      });
    }

    const [deletedImage] = images.splice(imageIndex, 1);

    // Handle primary image assignment
    if (deletedImage.is_primary && images.length > 0) {
      images[0].is_primary = true;
    }

    // Update display order
    images = images.map((img, index) => ({
      ...img,
      display_order: index,
    }));

    // Delete from cloudinary
    try {
      await deleteFromCloudinary(publicId);
      console.log(`Deleted image with publicId ${publicId} from Cloudinary`);
    } catch (cloudinaryErr) {
      console.log("Failed to delete image from cloudinary", cloudinaryErr);
      return res.status(500).json({
        success: false,
        message: "Failed to delete image from cloudinary",
        error: cloudinaryErr.message,
      });
    }

    // Update Database
    try {
      const result = await db.query(
      `UPDATE products
      SET images = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
      [JSON.stringify(images), productId]
      );

      const updatedProduct = result.rows[0];
      if (updatedProduct && typeof updatedProduct.images === "string") {
        updatedProduct.images = JSON.parse(updatedProduct.images);
      }

      res.status(200).json({
        success: true,
        message: "Image deleted successfully",
        product: updatedProduct,
        deletedImage: {
          public_id: deletedImage.public_id,
          url: deletedImage.url,
        }
      });
    } catch (dbErr) {
      console.error("Database update failed", dbErr);
      res.status(500).json({
        success: false,
        message: "Failed to update product after image deletion",
        error: dbErr.message,
      });
    }
  } catch (err) {
    console.log("Failed to delete image", err);
    res.status(500).json({
      success: false,
      message: "Failed to delete image",
      error: err.message,
    });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const productId = req.params.id;

    const product = await db.query("SELECT * FROM products WHERE id = $1", [
      productId,
    ]);

    if (product.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found" 
      });
    }

    let images = product.rows[0].images || [];

    // If images is a string, parse it to an array
    if (typeof images === "string") {
      try {
        images = JSON.parse(images);
      } catch (err) {
        console.log("Failed to parse images JSON", err);
        images = [];
      }
    }

    await db.query("DELETE FROM products WHERE id = $1", [productId]);

    // delete images from cloudinary
    if (images.length > 0) {
      for (const image of images) {
        if (image.public_id) {
          try {
            await deleteFromCloudinary(image.public_id);
            console.log(`Deleted image ${image.public_id} from Cloudinary`);
          } catch (err) {
            console.error(`Failed to delete image ${image.public_id}:`, err);
            // Log the error but continue deleting other images
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (err) {
    console.log("Error deleting product", err);
    res.status(500).json({
      success: false,
      message: "Failed to delete product",
      error: err.message
    });
  }
};

// ========================================
// ORDER CONTROLLERS
// ========================================

export const getOrdersAdmin = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    const ordersQuery = `
      SELECT
        o.*,
        a.line1, a.city, a.state, a.postal_code, a.country
      FROM orders o
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      ORDER BY o.placed_at DESC
      LIMIT $1 OFFSET $2
    `;

    const orders = await db.query(ordersQuery, [limit, offset]);

    // get order items for each order
    for (let order of orders.rows) {
      const itemsQuery = `
        SELECT
          oi.*,
          p.name as product_name, p.images
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = $1
      `;

      const items = await db.query(itemsQuery, [order.id]);
      order.items = items.rows;
    }

    // get total number of orders
    const countResult = await db.query(`SELECT COUNT(*) as total FROM orders`);
    const totalOrders = parseInt(countResult.rows[0].total);

    // calculate pagination
    const totalPages = Math.ceil(totalOrders / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.status(200).json({
      success: true,
      data: {
        orders: orders.rows
      },
      pagination: {
        current_page: page,
        per_page: limit,
        total_orders: totalOrders,
        total_pages: totalPages,
        has_next_page: hasNextPage,
        has_prev_page: hasPrevPage,
        next_page: hasNextPage ? page + 1 : null,
        prev_page: hasPrevPage ? page - 1 : null
      }
    });
  } catch (err) {
    console.log("Error getting orders", err);
    res.status(500).json({
      success: false,
      message: "Error getting orders",
      error: err.message,
    });
  }
};

export const getOrderAdmin = async (req, res) => {
  try {
    const id = req.params.id;

    if (!id || typeof id !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    const orderQuery = `
      SELECT
        o.*,
        a.line1, a.city, a.state, a.postal_code, a.country
      FROM orders o
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      WHERE o.id = $1
    `;

    const orderResult = await db.query(orderQuery, [id]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const order = orderResult.rows[0];

    // get order items
    const itemsQuery = `
      SELECT
        oi.*,
        p.name as product_name, p.images
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `;

    const items = await db.query(itemsQuery, [id]);
    order.items = items.rows;

    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (err) {
    console.log("Error getting order", err);
    res.status(500).json({
      success: false,
      message: "Error getting order",
      error: err.message,
    });
  }
};

export const verifyPaymentAdmin = async (req, res) => {
  try {
    const { reference } = req.body;

    // Input validation
    if (!reference || typeof reference !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid payment reference",
      });
    }

    // Check if order exists
    const existingOrder = await db.query(
      "SELECT * FROM orders WHERE payment_ref = $1",
      [reference]
    );

    if (existingOrder.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Payment reference not found",
      });
    }

    const order = existingOrder.rows[0];

    // Check if payment has already been verified
    if (order.status === "paid") {
      return res.status(409).json({
        success: false,
        message: "Payment already verified",
        data: {
          order: order,
          payment_status: "paid",
          payment_method: order.payment_method,
          customer_id: order.user_id,
          verification_type: "already_processed",
        },
      });
    }

    // Verify payment with paystack
    try {
      const verificationResponse = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(
        "Admin Paystack verification response:",
        verificationResponse.data
      );

      if (!verificationResponse.data.status) {
        return res.status(400).json({
          success: false,
          message: "Payment verification failed",
          error:
            verificationResponse.data.message || "Unknown verification error",
        });
      }

      const data = verificationResponse.data.data;
      const paymentStatus = data.status === "success" ? "paid" : "failed";
      const paymentMethod = data.channel;

      // update order status
      const updateQuery = `
      UPDATE orders
      SET
        status = $1, 
        payment_method = $2, 
        updated_at = now()
      WHERE payment_ref = $3 AND status = 'pending'
      RETURNING *
    `;

      const result = await db.query(updateQuery, [
        paymentStatus,
        paymentMethod,
        reference,
      ]);

      if (paymentStatus === "paid") {
        // Update product inventory
        try {
          await updateProductInventory(result.rows[0].id);
          console.log("Inventory updated successfully");
        } catch (inventoryError) {
          console.log("Inventory update failed:", inventoryError.message);
        }

        // Log the payment transaction for audit trail
        await db.query(
          `INSERT INTO payment_logs (order_id, payment_reference, status, amount, payment_method, processed_by, gateway_response, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now()) ON CONFLICT (payment_reference) DO NOTHING`,
          [
            result.rows[0].id,
            reference,
            paymentStatus,
            result.rows[0].total,
            paymentMethod,
            "admin",
            JSON.stringify(data.gateway_response) || "Payment successful",
          ]
        );
      } else {
        // Log the failed payment
        await db.query(
          `INSERT INTO payment_logs (order_id, payment_reference, status, failure_reason, processed_by, created_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (payment_reference) DO NOTHING`,
          [
            result.rows[0].id,
            reference,
            paymentStatus,
            data.gateway_response || "Payment failed",
            "admin",
          ]
        );
      }

      res.status(200).json({
        success: true,
        data: {
          order: result.rows[0],
          payment_status: paymentStatus,
          payment_method: paymentMethod,
          customer_id: result.rows[0].user_id,
          verification_type: "manual",
          verified_by: "admin",
          verified_at: new Date().toISOString(),
          admin_id: req.user.id,
        },
      });
    } catch (verificationError) {
      console.error(
        "Paystack verification error:",
        verificationError.response?.data || verificationError.message
      );

      return res.status(500).json({
        success: false,
        message: "Payment verification failed",
        error:
          verificationError.response?.data?.message ||
          verificationError.message,
      });
    }
  } catch (err) {
    console.log("Verify payment error", err);
    res.status(500).json({
      success: false,
      message: "Payment Verification failed",
      error: err.message,
    });
  }
};
