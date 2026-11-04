import * as shippingService from "../../services/shippingService.js";

export const addShippingAddress = async (req, res) => {
  const address = await shippingService.addAddress(req.user.id, req.body);

  res.status(201).json({
    success: true,
    message: "Shipping address added successfully",
    shipping_address: address,
  });
};

export const getUserShippingAddresses = async (req, res) => {
  const addresses = await shippingService.listAddresses(req.user.id);

  res.status(200).json({
    success: true,
    message: "Shipping addresses retrieved successfully",
    shipping_addresses: addresses,
  });
};

export const getShippingAddress = async (req, res) => {
  const address = await shippingService.getAddress(req.params.id, req.user.id);

  res.status(200).json({
    success: true,
    message: "Shipping address retrieved successfully",
    shipping_address: address,
  });
};

export const updateShippingAddress = async (req, res) => {
  const { address, warning } = await shippingService.updateAddress(req.params.id, req.user.id, req.body);

  res.status(200).json({
    success: true,
    message: "Shipping address updated successfully",
    shipping_address: address,
    ...(warning && { warning }),
  });
};

export const deleteShippingAddress = async (req, res) => {
  const address = await shippingService.deleteAddress(req.params.id, req.user.id);

  res.status(200).json({
    success: true,
    message: "Shipping address deleted successfully",
    deleted_shipping_address: address,
  });
};
