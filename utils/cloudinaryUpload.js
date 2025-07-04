import cloudinary from "../config/cloudinary.js";
import { Readable } from "stream";

// Helper function to check if a string is a valid URL
const isValidUrl = (string) => {
    try {
        const url = new URL(string);
        return url.protocol === "http:" || url.protocol === "https:";
    }catch (_) {
        return false;
    }
}

// Upload image from URL
const uploadImageFromUrl = (imageUrl, folder = 'products') => {
    return new Promise((resolve, reject) => {
        cloudinary.uploader.upload(
          imageUrl,
          {
            folder: folder,
            resource_type: "image",
            transformation: [
              { width: 800, height: 600, crop: "limit" }, //Resize if larger
              { quality: "auto" },
              { format: "auto" },
            ],
            allowed_formats: ["jpg", "png", "jpeg", "gif", "webp"],
          },
          (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve(result);
            }
          }
        );
    });
}

// Upload image as buffer
export const uploadToCloudinary = (fileBuffer, folder = "ecommerce") => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        transformation: [
          { width: 800, height: 600, crop: "limit" }, //Resize if larger
          { quality: "auto" },
          { format: "auto" },
        ],
        allowed_formats: ["jpg", "png", "jpeg", "gif", "webp"],
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    // convert buffer to stream and pipe to cloudinary
    const stream = Readable.from(fileBuffer);
    stream.pipe(uploadStream);
  });
};

// multiple uploads
export const uploadMultipleToCloudinary = async (
  files,
  folder = "ecommerce"
) => {
    const results = [];

    for (const file of files) {
        try {
            let result;

            // Check if file is a URL string
            if (typeof file === "string" && isValidUrl(file)) {
                // Upload image from URL
                console.log(`Uploading from URL: ${file}`);
                result = await uploadImageFromUrl(file, folder);
            } else if (file.buffer) {
                // Upload image as buffer
                console.log(`Uploading file buffer: ${file.originalname}`);
                result = await uploadToCloudinary(file.buffer, folder);
            } else {
                throw new Error('Invalid image data provided');
            }

            results.push(result)
        } catch (err) {
            console.error('Error uploading image:', err);
            throw err
        }
    }

  return results;
};

// delete upload
export const deleteFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (err) {
    throw new Error("Failed  to delete image from Cloudinary");
  }
};
