import { error } from "console";
import cloudinary from "../config/cloudinary";
import { Readable } from "stream";

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
  const uploadPromises = files.map((file) =>
    uploadToCloudinary(file.buffer, folder)
  );

  return Promise.all(uploadPromises);
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
