import * as productService from "../../services/productService.js";

export const addProduct = async (req, res) => {
  const product = await productService.createProduct(req.body, req.files);

  res.status(201).json({
    success: true,
    message: "Product added successfully",
    product,
  });
};

export const updateProduct = async (req, res) => {
  const product = await productService.updateProduct(req.params.id, req.body, req.files);

  res.status(200).json({
    success: true,
    message: "Product updated successfully",
    product,
  });
};

export const deleteProductImage = async (req, res) => {
  const { product, deletedImage } = await productService.removeProductImage(req.params.id, req.body.publicId);

  res.status(200).json({
    success: true,
    message: "Image deleted successfully",
    product,
    deletedImage: {
      public_id: deletedImage.public_id,
      url: deletedImage.url,
    },
  });
};

export const deleteProduct = async (req, res) => {
  await productService.deleteProduct(req.params.id);

  res.status(200).json({
    success: true,
    message: "Product deleted successfully",
  });
};
