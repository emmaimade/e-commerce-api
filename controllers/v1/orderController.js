import * as orderService from "../../services/orderService.js";
import * as paymentService from "../../services/paymentService.js";

export const createOrder = async (req, res) => {
  const data = await orderService.placeOrder(req.user, req.body.shipping_address_id);

  res.status(201).json({
    success: true,
    data,
  });
};

export const verifyPayment = async (req, res) => {
  const result = await paymentService.verifyCustomerPayment(req.params.reference, req.user);

  res.status(200).json({
    success: true,
    ...result,
  });
};

export const getOrders = async (req, res) => {
  const orders = await orderService.listCustomerOrders(req.user.id);

  res.status(200).json({
    success: true,
    data: orders,
  });
};

export const getOrder = async (req, res) => {
  const order = await orderService.getCustomerOrder(req.params.id, req.user.id);

  res.status(200).json({
    success: true,
    data: order,
  });
};

export const getOrderHistory = async (req, res) => {
  const history = await orderService.getCustomerOrderHistory(req.params.orderId, req.user.id);

  res.status(200).json({
    success: true,
    data: history,
  });
};

export const cancelOrder = async (req, res) => {
  const { order, refund } = await orderService.cancelCustomerOrder(req.params.orderId, req.user.id);

  res.status(200).json({
    success: true,
    message: "Order cancelled successfully",
    order,
    refund,
  });
};
