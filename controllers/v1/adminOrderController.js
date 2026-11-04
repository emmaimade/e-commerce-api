import * as orderService from "../../services/orderService.js";
import * as paymentService from "../../services/paymentService.js";

export const getOrdersAdmin = async (req, res) => {
  const { orders, pagination } = await orderService.listOrders(req.query);

  res.status(200).json({
    success: true,
    data: { orders },
    pagination,
  });
};

export const getOrderAdmin = async (req, res) => {
  const order = await orderService.getOrder(req.params.id);

  res.status(200).json({
    success: true,
    data: order,
  });
};

export const verifyPaymentAdmin = async (req, res) => {
  const result = await paymentService.verifyPaymentAsAdmin(req.body.reference, req.user.id);

  res.status(200).json({
    success: true,
    ...result,
  });
};

export const updateOrderStatus = async (req, res) => {
  const { status, notes } = req.body;

  const data = await orderService.changeOrderStatus(req.params.id, status, notes);

  res.status(200).json({
    success: true,
    message: "Order status updated successfully",
    data,
  });
};
