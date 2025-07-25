import axios from "axios";

import db from "../../config/db.js";
import { updateProductInventory } from "./paymentController.js";
import { uploadMultipleToCloudinary, deleteFromCloudinary } from "../../utils/cloudinaryUpload.js";
import { getNextDayString, isValidDateFormat} from "../../utils/dateHelpers.js";
import createTransporter from "../../utils/email.js";


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
  const client = await db.connect()

  try {
    await client.query("BEGIN");

    const { name, description, price, inventory_qty, image_urls } = req.body;
    let images = [];

    if (!name || !description || !price || !inventory_qty) {
      return res.status(400).json({
        success: false, 
        message: "All fields are required" 
      });
    }

    const priceNum = parseInt(price);
    const inventoryNum = parseInt(inventory_qty);

    if (isNaN(priceNum) || isNaN(inventoryNum)) {
      return res
        .status(400)
        .json({ 
          success: false,
          message: "Price and inventory must be numbers" 
        });
    }

    if (priceNum <= 0 || inventoryNum <= 0) {
      return res
        .status(400)
        .json({ 
          success: false,
          message: "Price and inventory must be greater than 0" 
        });
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

    const newProduct = await client.query(
      `INSERT INTO products (name, description, price, inventory_qty, images) 
      VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description, priceNum, inventoryNum, JSON.stringify(images)]
    );

    const product = newProduct.rows[0];
    // Convert image to array for response
    if (typeof product.images === "string") {
      product.images = JSON.parse(product.images);
    }

    // Commit transaction
    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "Product added successfully",
      product: product,
    });
  } catch (err) {
    console.log("Error adding product", err);
    await client.query("ROLLBACK");
    res.status(500).json({ 
        success: false,
        message: "Error adding product",
        error: err.message
     });
  }
};

export const updateProduct = async (req, res) => {
  const client = await db.connect();
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
    const allowedFields = ["name", "price", "description", "inventory_qty", "status"];
    const allowedUpdates = {};

    // Filter only allowed fields
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && value.trim() && value !== undefined && value !== "") {
        allowedUpdates[key] = value.trim();
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
        console.warn(
          "Current images is not an array after parsing, resetting to empty array"
        );
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
      const validUrls = urls.filter(
        (url) => typeof url === "string" && url.trim() !== ""
      );
      imagesToUpload = [...imagesToUpload, ...validUrls];
    }

    // Checks if price is a number
    if (allowedUpdates.price) {
      if (isNaN(allowedUpdates.price)) {
        return res.status(400).json({
          success: false,
          message: "Price must be a number",
        });
      }
      // Checks if price is greater than one
      if (allowedUpdates.price <= 0) {
        return res.status(400).json({
          success: false,
          message: "Price must be greater than 0",
        });
      }
    }

    // Validate inventory
    if (allowedUpdates.inventory_qty) {
      const newQuantity = parseInt(allowedUpdates.inventory_qty);

      // check if inventory_qty is a number
      if (isNaN(newQuantity)) {
        return res.status(400).json({
          success: false,
          message: "Inventory must be a number",
        });
      }

      const currentInventory = parseInt(existingProduct.rows[0].inventory_qty) || 0;

      // Add newQuantity to existing inventory
      const updatedInventory = currentInventory + newQuantity;

      // checks if inventory_qty is greater than one
      if (updatedInventory <= 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot reduce inventory below 0, current inventory: ${currentInventory}, attempted reduction: ${Math.abs(newQuantity)}`,
        });
      }

      // Update inventory
      allowedUpdates.inventory_qty = updatedInventory;

      if (parseInt(updatedInventory) > 0) {
        allowedUpdates.status = 'active';
      } else {
        allowedUpdates.status = 'out_of_stock';
      }
    }

    // Check if there are any updates to make (including images)
    if (
      Object.keys(allowedUpdates).length === 0 &&
      imagesToUpload.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
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

      // Commit transaction
      await client.query("COMMIT");

      res.status(200).json({
        success: true,
        message: "Product updated successfully",
        product: updatedProduct,
      });
    } catch (dbErr) {
      console.error("Database update failed", dbErr);

      // Rollback transaction
      await client.query("ROLLBACK");

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
    await client.query("ROLLBACK");
    res.status(500).json({
      success: false,
      message: "Error updating product",
      error: err.message,
    });
  } finally {
    client.release();
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

    // Search by order status and payment status
    const { order_status, payment_status } = req.query;

    let whereClause = "";
    const queryParams = [];
    let paramIndex = 1;

    // Handle order status filtering
    if (order_status) {
      whereClause += whereClause ? " AND" : " WHERE";
      whereClause += ` o.order_status = $${paramIndex}`;
      queryParams.push(order_status);
      paramIndex++;
    }

    // Handle payment status filtering
    if (payment_status) {
      whereClause += whereClause ? " AND" : " WHERE";
      whereClause += ` o.status = $${paramIndex}`;
      queryParams.push(payment_status);
      paramIndex++;
    }

    // Add limit and offset
    queryParams.push(limit, offset);

    // Get orders
    const ordersQuery = `
      SELECT
        o.*,
        u.name as customer_name, u.email as customer_email,
        a.phone, a.line1, a.city, a.postal_code, a.country,
        COUNT(oi.id) as item_count,
        SUM(oi.quantity * oi.price) as total
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      ${whereClause}
      GROUP BY u.name, u.email, o.id, a.phone, a.line1, a.city, a.postal_code, a.country
      ORDER BY o.placed_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const orders = await db.query(ordersQuery, queryParams);

    // Get total number of orders
    const countQuery = `SELECT COUNT(*) as total FROM orders o ${whereClause}`;
    const countParams = queryParams.slice(0, -2);
    const countResult = await db.query(countQuery, countParams);
    const totalOrders = parseInt(countResult.rows[0].total);

    // Calculate pagination
    const totalPages = Math.ceil(totalOrders / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.status(200).json({
      success: true,
      data: {
        orders: orders.rows.length > 0 ? orders.rows : "No orders found",
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
        u.name as customer_name, u.email as customer_email,
        a.phone, a.line1, a.city, a.postal_code, a.country
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
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
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { reference } = req.body;

    // Input validation
    if (!reference || typeof reference !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid payment reference",
      });
    }

    // Check if order exists
    const existingOrder = await client.query(
      "SELECT * FROM orders WHERE payment_ref = $1",
      [reference]
    );

    if (existingOrder.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Payment reference not found",
      });
    }

    const order = existingOrder.rows[0];

    // Check if payment has already been verified
    if (order.status === "paid") {
      await client.query("COMMIT");
      return res.status(409).json({
        success: true,
        message: "Payment already verified",
        data: {
          order: order,
          payment_status: "paid",
          payment_method: order.payment_method,
          customer_id: order.user_id,
          verification_type: "already_processed",
          verified_at: order.updated_at,
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
          timeout: 10000, // 10 seconds timeout
        }
      );

      console.log(
        "Admin Paystack verification response:",
        verificationResponse.data
      );

      if (!verificationResponse.data.status) {
        console.error("Paystack verification failed:", verificationResponse.data);

        await client.query("ROLLBACK");

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
        order_status = 'processing',
        updated_at = now()
      WHERE payment_ref = $3 AND status = 'pending'
      RETURNING *
    `;

      const result = await client.query(updateQuery, [
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
        await client.query(
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

        // Update order status history
        await client.query(
          `INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)`,
          [result.rows[0].id, "processing", "Payment verified by admin, order is being processed"]
        );

        // Send email to customer
        try {
          const customerQuery = await client.query(
            "SELECT email, first_name FROM users WHERE id = $1",
            [result.rows[0].user_id]
          );
          
          if (customerQuery.rows.length > 0) {
            const customer = customerQuery.rows[0];
            const transporter = createTransporter();

            const mailOptions = {
              from: `E-commerce API <${process.env.EMAIL_USER}>`,
              to: customer.email,
              subject: "Payment Confirmed - Your Order is Being Processed",
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <!-- Header -->
                  <div style="text-align: center; border-bottom: 2px solid #28a745; padding-bottom: 20px; margin-bottom: 30px;">
                    <h1 style="color: #333; margin: 0;">✅ Payment Confirmed!</h1>
                    <p style="color: #666; margin: 5px 0;">Your order is now being processed</p>
                  </div>

                  <!-- Greeting -->
                  <p style="font-size: 16px;">Hi ${
                    customer.name || "Valued Customer"
                  },</p>
                  <p>Great news! Your payment for order <strong>#${
                    result.rows[0].id
                  }</strong> has been manually verified by our team. Your order is now being processed and will be prepared for shipment.</p>
                  
                  <!-- Success Banner -->
                  <div style="background-color: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
                    <strong>🎉 Payment Successfully Verified by Admin</strong>
                  </div>

                  <!-- Order Details Card -->
                  <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; border-left: 4px solid #28a745;">
                    <h3 style="margin-top: 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Payment & Order Details</h3>
                    <table style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td style="padding: 10px 0; font-weight: bold; color: #555;">Order ID:</td>
                        <td style="padding: 10px 0; color: #007bff; font-weight: bold;">#${
                          result.rows[0].id
                        }</td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0; font-weight: bold; color: #555;">Order Status:</td>
                        <td style="padding: 10px 0;">
                          <span style="background-color: #ffc107; color: #000; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">
                            PROCESSING
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0; font-weight: bold; color: #555;">Payment Reference:</td>
                        <td style="padding: 10px 0; font-family: monospace; background-color: #e9ecef; padding: 5px 8px; border-radius: 4px;">${reference}</td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0; font-weight: bold; color: #555;">Payment Method:</td>
                        <td style="padding: 10px 0; text-transform: capitalize;">${paymentMethod}</td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0; font-weight: bold; color: #555;">Amount Paid:</td>
                        <td style="padding: 10px 0; font-size: 18px; color: #28a745; font-weight: bold;">
                          ₦${result.rows[0].total.toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0; font-weight: bold; color: #555;">Verified By:</td>
                        <td style="padding: 10px 0; color: #dc3545; font-weight: bold;">Admin Team</td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0; font-weight: bold; color: #555;">Verification Date:</td>
                        <td style="padding: 10px 0;">${new Date().toLocaleDateString(
                          "en-US",
                          {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}</td>
                      </tr>
                    </table>
                  </div>

                  <!-- Next Steps -->
                  <div style="background-color: #e8f4f8; padding: 20px; border-radius: 8px; margin: 25px 0;">
                    <h3 style="margin-top: 0; color: #2c5aa0;">📦 What Happens Next?</h3>
                    <ol style="padding-left: 20px; line-height: 1.6;">
                      <li><strong>Order Processing</strong> - We're preparing your items for shipment</li>
                      <li><strong>Quality Check</strong> - Each item is carefully inspected</li>
                      <li><strong>Packaging</strong> - Your order will be securely packaged</li>
                      <li><strong>Shipping</strong> - You'll receive tracking information via email</li>
                      <li><strong>Delivery</strong> - Your order will arrive at your specified address</li>
                    </ol>
                    <p style="margin-bottom: 0; font-size: 14px; color: #666;">
                      <strong>Estimated processing time:</strong> 1-2 business days
                    </p>
                  </div>

                  <!-- Support Section -->
                  <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0;">
                    <h4 style="margin-top: 0; color: #333;">Need Help? 🤝</h4>
                    <p style="margin-bottom: 10px;">Our customer support team is here to help:</p>
                    <ul style="list-style: none; padding-left: 0;">
                      <li style="margin: 8px 0;">📧 <strong>Email:</strong> ${
                        process.env.EMAIL_USER
                      }</li>
                      <li style="margin: 8px 0;">📞 <strong>Phone:</strong> ${process.env.SUPPORT_PHONE || '+234-XXX-XXXX-XXX'}</li>
                      <li style="margin: 8px 0;">💬 <strong>Live Chat:</strong> Available on our website</li>
                    </ul>
                    <p style="font-size: 14px; color: #666; margin-bottom: 0;">
                      Please reference Order ID <strong>#${
                        result.rows[0].id
                      }</strong> when contacting support.
                    </p>
                  </div>

                  <!-- Footer -->
                  <div style="text-align: center; padding-top: 30px; border-top: 1px solid #ddd; margin-top: 40px;">
                    <p style="font-size: 18px; margin-bottom: 10px;">Thank you for shopping with us! 🛍️</p>
                    <p style="color: #666; margin-bottom: 20px;">
                      Best regards,<br>
                      <strong>The E-commerce API Team</strong>
                    </p>
                    
                    <!-- Email Footer -->
                    <div style="font-size: 12px; color: #999; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
                      <p>This email was sent to <strong>${customer.email}</strong></p>
                      <p>© 2024 E-commerce API. All rights reserved.</p>
                      <p>If you have any concerns about this transaction, please contact us immediately.</p>
                    </div>
                  </div>
                </div>
              `,
            };

            await transporter.sendMail(mailOptions);
            console.log("Payment Confirmation Email sent successfully");
          }
        } catch (emailError) {
          console.error("Email sending failed:", emailError.message);
        }
      } else {
        // Log the failed payment
        await client.query(
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

        // Update order status history
        await client.query(
          "INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)",
          [result.rows[0].id, "failed", "Payment verification failed"]
        );
      }

      await client.query("COMMIT");

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

      await client.query("ROLLBACK");

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
    await client.query("ROLLBACK");
    res.status(500).json({
      success: false,
      message: "Payment Verification failed",
      error: err.message,
    });
  } finally {
    client.release();
  }
};

export const updateOrderStatus = async (req, res) => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const orderId = req.params.id;
    const { status, notes } = req.body;

    // Input validation
    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Order status is required",
      });
    }

    // Validate status
    const validStatuses = ["processing", "shipped", "delivered", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Valid statuses are: ${validStatuses.join(", ")}`,
      });
    }

    // Get current user order with customer details
    const currentOrderQuery = await client.query(
      `SELECT 
        o.*, 
        u.email, u.name 
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.id = $1`,
      [orderId]
    );

    if (currentOrderQuery.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    const currentOrder = currentOrderQuery.rows[0];
    const previousStatus = currentOrder.order_status;

    // Check if order status has changed
    const shouldSendEmail = previousStatus !== status;

    const query = `
      UPDATE orders
        SET order_status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const result = await client.query(query, [status, orderId]);

    // Update Order Status History
    await client.query(
      "INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)",
      [orderId, status, notes]
    );

    // Send email notification if status changed
    if (shouldSendEmail) {
      try {
        const transporter = createTransporter();

        const statusMessages = {
          processing: "Your order is being prepared for shipment.",
          shipped: "Your order has been shipped and is on its way to you!",
          delivered: "You order has been successfully delivered. We hope you love it!",
          cancelled: "Your order has been cancelled. If you have questions, please contact our support team."
        };

        const statusColors = {
          processing: "#ffc107",
          shipped: "#17a2b8", 
          delivered: "#28a745",
          cancelled: "#dc3545"
        };

        const statusEmojis = {
          processing: "⚙️",
          shipped: "🚚",
          delivered: "✅",
          cancelled: "❌"
        };

        const mailOptions = {
          from: `E-commerce API <${process.env.EMAIL_USER}>`,
          to: currentOrder.email,
          subject: `Order Update - ${status.charAt(0).toUpperCase() + status.slice(1)}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <!-- Header -->
              <div style="text-align: center; border-bottom: 2px solid ${statusColors[status] || '#007bff'}; padding-bottom: 20px; margin-bottom: 30px;">
                <h1 style="color: #333; margin: 0;">${statusEmojis[status] || '📦'} Order Status Update</h1>
                <p style="color: #666; margin: 5px 0;">Your order status has been updated</p>
              </div>

              <!-- Greeting -->
              <p style="font-size: 16px;">Hi ${currentOrder.name || "Valued Customer"},</p>
              <p>We wanted to keep you updated on your order. The status has been updated from <strong>${previousStatus.toUpperCase()}</strong> to <strong>${status.toUpperCase()}</strong>.</p>
              
              <!-- Status Banner -->
              <div style="background-color: ${statusColors[status] || '#007bff'}; color: white; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
                <h2 style="margin: 0; text-transform: uppercase;">${statusEmojis[status] || '📦'} ${status}</h2>
              </div>

              <!-- Order Details Card -->
              <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; border-left: 4px solid ${statusColors[status] || '#007bff'};">
                <h3 style="margin-top: 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Order Details</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 10px 0; font-weight: bold; color: #555;">Order ID:</td>
                    <td style="padding: 10px 0; color: #007bff; font-weight: bold;">#${orderId}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; font-weight: bold; color: #555;">Order Total:</td>
                    <td style="padding: 10px 0; font-size: 16px; font-weight: bold;">₦${currentOrder.total.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; font-weight: bold; color: #555;">Status:</td>
                    <td style="padding: 10px 0;">
                      <span style="background-color: ${statusColors[status] || '#007bff'}; color: white; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">
                        ${status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; font-weight: bold; color: #555;">Updated:</td>
                    <td style="padding: 10px 0;">${new Date().toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric", 
                      hour: "2-digit",
                      minute: "2-digit",
                    })}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; font-weight: bold; color: #555;">Updated By:</td>
                    <td style="padding: 10px 0; color: #dc3545; font-weight: bold;">Admin Team</td>
                  </tr>
                  ${notes ? `
                  <tr>
                    <td style="padding: 10px 0; font-weight: bold; color: #555; vertical-align: top;">Notes:</td>
                    <td style="padding: 10px 0; background-color: #fff3cd; padding: 8px 12px; border-radius: 4px; border-left: 3px solid #ffc107;">${notes}</td>
                  </tr>
                  ` : ''}
                </table>
              </div>

              <!-- Status Message -->
              <div style="background-color: #e8f4f8; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <p style="margin: 0; font-size: 16px; line-height: 1.6; text-align: center;">
                  ${statusMessages[status] || 'Your order status has been updated.'}
                </p>
              </div>

              ${status === 'shipped' ? ` 
              <!-- Shipping Info (if shipped) --> 
              <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; padding: 20px; border-radius: 8px; margin: 25px 0;"> 
                <h4 style="margin-top: 0; color: #0c5460;">🚚 Shipping Information</h4> 
                <p style="margin-bottom: 10px;">Your order is on its way! You can track your shipment using the tracking information that will be provided separately.</p> 
                <p style="margin-bottom: 15px; font-size: 14px; color: #0c5460;"> 
                  <strong>Estimated delivery:</strong> 3-5 business days 
                </p>
                
                <!-- Order History Button -->
                <div style="text-align: center; margin-top: 20px;">
                  <a href="${process.env.BASE_URL}/v1/order/${orderId}/history" 
                    style="display: inline-block; 
                            background-color: #17a2b8; 
                            color: white; 
                            padding: 10px 20px; 
                            text-decoration: none; 
                            border-radius: 5px; 
                            font-weight: bold; 
                            transition: background-color 0.3s ease;
                            border: none;
                            cursor: pointer;"
                    onmouseover="this.style.backgroundColor='#138496'" 
                    onmouseout="this.style.backgroundColor='#17a2b8'">
                    📋 View Order History
                  </a>
                </div>
              </div> 
              ` : ''}

              ${status === 'delivered' ? `
              <!-- Delivery Confirmation -->
              <div style="background-color: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h4 style="margin-top: 0; color: #155724;">🎉 Delivery Confirmed!</h4>
                <p style="margin-bottom: 15px;">We hope you're happy with your purchase! If you have a moment, we'd love to hear about your experience.</p>
                <div style="text-align: center;">
                  <a href="#" style="display: inline-block; background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                    Leave a Review
                  </a>
                </div>
              </div>
              ` : ''}

              ${status === 'cancelled' ? `
              <!-- Cancellation Info -->
              <div style="background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h4 style="margin-top: 0; color: #721c24;">Order Cancellation</h4>
                <p style="margin-bottom: 10px;">If a payment was processed, the refund will be credited back to your original payment method within 5-7 business days.</p>
                <p style="margin-bottom: 0;">If you have any questions about this cancellation, please don't hesitate to contact our support team.</p>
              </div>
              ` : ''}

              <!-- Support Section -->
              <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h4 style="margin-top: 0; color: #333;">Need Help? 🤝</h4>
                <p style="margin-bottom: 10px;">Questions about your order? We're here to help:</p>
                <ul style="list-style: none; padding-left: 0;">
                  <li style="margin: 8px 0;">📧 <strong>Email:</strong> ${process.env.EMAIL_USER}</li>
                  <li style="margin: 8px 0;">📞 <strong>Phone:</strong> ${process.env.SUPPORT_PHONE || '+234-XXX-XXXX-XXX'}</li>
                  <li style="margin: 8px 0;">💬 <strong>Live Chat:</strong> Available on our website</li>
                </ul>
                <p style="font-size: 14px; color: #666; margin-bottom: 0;">
                  Please reference Order ID <strong>#${orderId}</strong> when contacting support.
                </p>
              </div>

              <!-- Footer -->
              <div style="text-align: center; padding-top: 30px; border-top: 1px solid #ddd; margin-top: 40px;">
                <p style="font-size: 18px; margin-bottom: 10px;">Thank you for shopping with us! 🛍️</p>
                <p style="color: #666; margin-bottom: 20px;">
                  Best regards,<br>
                  <strong>The E-commerce API Team</strong>
                </p>
                
                <!-- Email Footer -->
                <div style="font-size: 12px; color: #999; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
                  <p>This email was sent to <strong>${currentOrder.email}</strong></p>
                  <p>© 2024 E-commerce API. All rights reserved.</p>
                </div>
              </div>
            </div>
          `,
        };

        await transporter.sendMail(mailOptions);
        console.log(`Order status update email sent for status: ${status}`);
      } catch (emailError) {
        console.error("Email sending failed:", emailError.message);
      }
    }

    await client.query("COMMIT");
    res.status(200).json({
      success: true,
      message: "Order status updated successfully",
      data: {
        ...result.rows[0],
        email_sent: shouldSendEmail,
        previous_status: previousStatus
      },
    });
  } catch (err) {
    console.log("Error updating order status", err);
    await client.query("ROLLBACK");
    res.status(500).json({
      success: false,
      message: "Failed to update order status",
      error: err.message,
    });
  } finally {
    client.release();
  }
};

// ========================================
// PAYMENT CONTROLLER
// ========================================

export const getPaymentStatusAdmin = async (req, res) => {
  try {
    const { reference } = req.params;

    // Input validation
    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference is required",
      });
    }

    const query = `
      SELECT
          o.id, 
          o.status as payment_status, 
          o.payment_method, 
          o.payment_ref as payment_reference, 
          o.order_status, 
          o.total as total_amount, 
          o.placed_at, 
          o.user_id,
          u.name as customer_name, 
          u.email as customer_email,
          COUNT(oi.id) as item_count
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.payment_ref =$1
      GROUP BY o.id, u.name, u.email
    `;

    const result = await db.query(query, [reference]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment reference not found",
      });
    }

    const orderData = result.rows[0];

    // Get payment logs for this reference
    const logsQuery = `
      SELECT
          status,
          processed_by,
          created_at,
          failure_reason,
          gateway_response
      FROM payment_logs
      WHERE payment_reference = $1
      ORDER BY created_at DESC
      LIMIT 10
    `;

    const logsResult = await db.query(logsQuery, [reference]);

    // No cache for admin queries
    res.set("Cache-Control", "no-cache");

    res.status(200).json({
      success: true,
      data: {
        ...orderData,
        payment_logs: logsResult.rows,
        last_updated: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("Error getting payment status (admin):", err);
    res.status(500).json({
      success: false,
      message: "Failed to get payment status",
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Internal server error",
    });
  }
};

export const getPaymentLogs = async (req, res) => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const {
      page = 1,
      limit = 20,
      status,
      payment_method,
      order_id,
      date_from,
      date_to,
      search,
    } = req.query;

    // Validate pagination parameters
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    // Build dynamic query
    let whereClause = "WHERE 1 = 1";
    const queryParams = [];
    let paramIndex = 1;

    // Filter by status
    if (status) {
      whereClause += ` AND pl.status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    // Filter by payment method
    if (payment_method) {
      whereClause += ` AND pl.payment_method = $${paramIndex}`;
      queryParams.push(payment_method);
      paramIndex++;
    }

    // Filter by order ID
    if (order_id) {
      whereClause += ` AND pl.order_id = $${paramIndex}`;
      queryParams.push(order_id);
      paramIndex++;
    }

    // Validate dates first
    if (date_from && !isValidDateFormat(date_from)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Please use YYYY-MM-DD format.",
        example: "2024-01-15"
      })
    }

    if (date_to && !isValidDateFormat(date_to)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Please use YYYY-MM-DD format.",
        example: "2024-01-15"
      })
    }

    // Filter by date range
    if (date_from && date_to) {
      const nextDayString = getNextDayString(date_to);
      console.log(nextDayString);

      whereClause += ` AND pl.created_at >= $${paramIndex} AND pl.created_at < $${paramIndex + 1}`;
      queryParams.push(date_from, nextDayString);
      paramIndex += 2;
    } else if (date_from) {
      whereClause += ` AND pl.created_at >= $${paramIndex}`;
      queryParams.push(date_from);
      paramIndex++;
    } else if (date_to) {
      const nextDayString = getNextDayString(date_to);
      console.log(nextDayString);

      whereClause += ` AND pl.created_at <= $${paramIndex}`;
      queryParams.push(nextDayString);
      paramIndex++;
    }

    // Search functionality (payment_reference, customer email)
    if (search) {
      whereClause += ` AND (
        pl.payment_reference ILIKE $${paramIndex} OR 
        u.email ILIKE $${paramIndex}
      )`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // Build payment logs query
    const logsQuery = `
      SELECT
        pl.id,
        pl.order_id,
        pl.payment_reference,
        pl.status,
        pl.amount,
        pl.payment_method,
        pl.processed_by,
        pl.failure_reason,
        pl.gateway_response,
        pl.created_at,
        o.user_id,
        o.order_status,
        o.total as order_total,
        u.email as customer_email,
        u.name as customer_name,
        a.city as shipping_city,
        a.country as shipping_country
      FROM payment_logs pl
      LEFT JOIN orders o ON pl.order_id = o.id
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      ${whereClause}
      ORDER BY pl.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(limitNum, offset);

    // Count query for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM payment_logs pl
      LEFT JOIN orders o ON pl.order_id = o.id
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      ${whereClause}
    `;

    const countParams = queryParams.slice(0, -2); // Exclude limit and offset

    // Execute both queries
    const [logsResult, countResult] = await Promise.all([
      client.query(logsQuery, queryParams),
      client.query(countQuery, countParams),
    ]);

    const logs = logsResult.rows;
    const totalRecords = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalRecords / limitNum);

    // Calculate Summary statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_transactions,
        SUM(CASE WHEN pl.status = 'paid' THEN pl.amount ELSE 0 END) as total_successful_amount,
        COUNT(CASE WHEN pl.status = 'paid' THEN 1 END) as successful_transactions,
        COUNT(CASE WHEN pl.status = 'failed' THEN 1 END) as failed_transactions,
        COUNT(CASE WHEN pl.status = 'pending' THEN 1 END) as pending_transactions,
        COUNT(CASE WHEN pl.status = 'cancelled' THEN 1 END) as cancelled_transactions,
        COUNT(CASE WHEN pl.status = 'refunded' THEN 1 END) as refunded_transactions
      FROM payment_logs pl
      LEFT JOIN orders o ON pl.order_id = o.id
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      ${whereClause}
    `;
    
    const statsResult = await client.query(statsQuery, countParams);
    const stats = statsResult.rows[0];

    // Format response
    const formattedLogs = logs.map((log) => ({
      id: log.id,
      order_id: log.order_id,
      payment_reference: log.payment_reference,
      status: log.status,
      amount: log.amount,
      payment_method: log.payment_method,
      processed_by: log.processed_by,
      created_at: log.created_at,
      customer: {
        id: log.user_id,
        email: log.customer_email,
        name: log.customer_name
      },
      order: {
        status: log.order_status,
        total: log.order_total,
        shipping_location: log.shipping_city && log.shipping_country ? `${log.shipping_city}, ${log.shipping_country}` : null
      },
      failure_reason: log.failure_reason,
      gateway_response: log.gateway_response,
    }));

    // Commit transaction
    await client.query("COMMIT");

    res.status(200).json({
      success: true,
      data: {
        logs: formattedLogs,
        pagination: {
          current_page: pageNum,
          total_pages: totalPages,
          total_records: totalRecords,
          per_page: limitNum,
          has_next_page: pageNum < totalPages,
          has_prev_page: pageNum > 1
        },
        statistics: {
          total_transactions: parseInt(stats.total_transactions),
          successful_transactions: parseInt(stats.successful_transactions),
          failed_transactions: parseInt(stats.failed_transactions),
          pending_transactions: parseInt(stats.pending_transactions),
          cancelled_transactions: parseInt(stats.cancelled_transactions),
          refunded_transactions: parseInt(stats.refunded_transactions),
          total_successful_amount: parseFloat(stats.total_successful_amount),
          success_rate: stats.total_transactions > 0 ? ((stats.successful_transactions / stats.total_transactions) * 100 ).toFixed(2): 0
        },
        filters_applied: {
          status: status || null,
          payment_method: payment_method || null,
          order_id: order_id || null,
          date_range: {
            from: date_from || null,
            to: date_to || null
          },
          search: search || null,
        }
      }
    })
  } catch (err) {
    console.error("Error fetching payment logs:", err);

    await client.query("ROLLBACK");
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch payment logs",
      error: err.message 
    });
  } finally {
    client.release();
  }
};

export const getPaymentAnalytics = async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { period = '30d' } = req.query;

    let dateFilter = ''; 
    if (period === '7d') {
      dateFilter = "AND pl.created_at >= NOW() - INTERVAL '7 days'";
    } else if (period === '30d') {
      dateFilter = "AND pl.created_at >= NOW() - INTERVAL '30 days'";
    } else if (period === '90d') {
      dateFilter = "AND pl.created_at >= NOW() - INTERVAL '90 days'";
    } else if (period === '1y') {
      dateFilter = "AND pl.created_at >= NOW() - INTERVAL '1 year'";
    }

    // Revenue analytics
    const analyticsQuery = `
      SELECT
        DATE_TRUNC('day', pl.created_at) as date,
        COUNT(*) as total_transactions,
        COUNT(CASE WHEN pl.status = 'paid' THEN 1 END) as successful_transactions,
        SUM(CASE WHEN pl.status = 'paid' THEN amount ELSE 0 END) as daily_revenue,
        AVG(CASE WHEN pl.status = 'paid' THEN amount END) as avg_transaction_value
      FROM payment_logs pl
      WHERE 1=1 ${dateFilter}
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date DESC
    `;

    // Payment method
    const methodQuery = `
      SELECT
        payment_method,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'paid' THEN amount END) as total_amount
      FROM payment_logs pl
      WHERE status = 'paid' ${dateFilter}
      GROUP BY payment_method
      ORDER BY total_amount DESC
    `;

    const [analyticsResult, methodResult] = await Promise.all([
      client.query(analyticsQuery),
      client.query(methodQuery)
    ]);

    // Commit transaction
    await client.query("COMMIT");

    res.status(200).json({
      success: true,
      data: {
        daily_analytics: analyticsResult.rows,
        payment_methods: methodResult.rows,
        period: period
      }
    });
  } catch (err) {
    console.error("Error fetching payment analytics:", err);

    await client.query("ROLLBACK");
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch payment analytics",
      error: err.message 
    });
  } finally {
    client.release();
  }
}