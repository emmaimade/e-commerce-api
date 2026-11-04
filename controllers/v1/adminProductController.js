import db from "../../config/db.js";
import { uploadMultipleToCloudinary, deleteFromCloudinary } from "../../utils/cloudinaryUpload.js";
import { HttpError } from "../../utils/httpError.js";
import { FOREIGN_KEY_VIOLATION } from "../../utils/validators.js";

export const addProduct = async (req, res) => {
  try {
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
    const allowedFields = ["name", "price", "description", "inventory_qty", "status"];
    const allowedUpdates = {};

    // Filter only allowed fields
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && value !== undefined && value !== null && String(value).trim() !== "") {
        allowedUpdates[key] = String(value).trim();
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

    // inventory_qty is a change to stock, positive or negative. It is applied
    // in the UPDATE below so it can't overwrite a concurrent reservation.
    let stockChange = null;

    if (allowedUpdates.inventory_qty) {
      stockChange = parseInt(allowedUpdates.inventory_qty);

      // check if inventory_qty is a number
      if (isNaN(stockChange)) {
        return res.status(400).json({
          success: false,
          message: "Inventory must be a number",
        });
      }

      delete allowedUpdates.inventory_qty;
    }

    // Check if there are any updates to make (including images)
    if (
      Object.keys(allowedUpdates).length === 0 &&
      stockChange === null &&
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
        });
      }
    }

    // Database Update
    try {
      // Dynamic sql query
      const params = Object.values(allowedUpdates);
      const setClauses = Object.keys(allowedUpdates).map(
        (field, index) => `${field} = $${index + 1}`
      );
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
      const query = `UPDATE products SET ${setClauses.join(", ")}, updated_at = NOW()
        WHERE id = $${params.length} ${stockGuard} RETURNING *`;

      // Update product
      const result = await db.query(query, params);

      if (result.rows.length === 0) {
        throw new HttpError(400, "Cannot reduce inventory below 0");
      }

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
      if (dbErr instanceof HttpError) {
        return res.status(dbErr.status).json({
          success: false,
          message: dbErr.message,
        });
      }

      res.status(500).json({
        success: false,
        message: "Database update failed",
      });
    }
  } catch (err) {
    console.log("Error updating product", err);
    res.status(500).json({
      success: false,
      message: "Error updating product",
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
      });
    }
  } catch (err) {
    console.log("Failed to delete image", err);
    res.status(500).json({
      success: false,
      message: "Failed to delete image",
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
    if (err.code === FOREIGN_KEY_VIOLATION) {
      return res.status(409).json({
        success: false,
        message: "This product is part of an order or cart and can't be deleted. Set its status to inactive instead.",
      });
    }

    console.log("Error deleting product", err);
    res.status(500).json({
      success: false,
      message: "Failed to delete product",
    });
  }
};
