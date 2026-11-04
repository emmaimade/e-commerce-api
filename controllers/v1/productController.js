import * as productService from "../../services/productService.js";

export const getProducts = async (req, res) => {
  const data = await productService.listProducts(req.query);
  const { search, min_price, max_price } = req.query;

  // 1 min for filtered, 5 min for all
  const cacheTime = search || min_price || max_price ? 60 : 300;
  res.set("Cache-Control", `private, max-age=${cacheTime}`);

  res.status(200).json({
    success: true,
    data,
  });
};

export const getProduct = async (req, res) => {
  const product = await productService.getProduct(req.params.id);

  // Short, because this includes live stock
  res.set("Cache-Control", "private, max-age=60");

  res.status(200).json({
    success: true,
    data: { product },
  });
};
