import * as paymentReportService from "../../services/paymentReportService.js";
import * as refundService from "../../services/refundService.js";

export const getPaymentStatusAdmin = async (req, res) => {
  const data = await paymentReportService.getPaymentStatus(req.params.reference);

  // No cache for admin queries
  res.set("Cache-Control", "no-cache");

  res.status(200).json({
    success: true,
    data,
  });
};

export const getPaymentLogs = async (req, res) => {
  const data = await paymentReportService.getPaymentLogs(req.query);

  res.status(200).json({
    success: true,
    data,
  });
};

export const getRefunds = async (req, res) => {
  const data = await refundService.listRefunds(req.query);

  res.status(200).json({
    success: true,
    data,
  });
};

export const retryRefund = async (req, res) => {
  const refund = await refundService.retryFailedRefund(req.params.refundId);

  res.status(200).json({
    success: true,
    message: "Refund retried",
    data: refund,
  });
};

export const getPaymentAnalytics = async (req, res) => {
  const data = await paymentReportService.getPaymentAnalytics(req.query.period);

  res.status(200).json({
    success: true,
    data,
  });
};
