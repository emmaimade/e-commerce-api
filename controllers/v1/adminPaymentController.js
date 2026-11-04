import * as paymentReportService from "../../services/paymentReportService.js";

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

export const getPaymentAnalytics = async (req, res) => {
  const data = await paymentReportService.getPaymentAnalytics(req.query.period);

  res.status(200).json({
    success: true,
    data,
  });
};
