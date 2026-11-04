import db from "../config/db.js";
import { HttpError } from "../utils/httpError.js";
import { getNextDayString, isValidDateFormat } from "../utils/dateHelpers.js";

const ANALYTICS_PERIODS = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "1y": "1 year",
};

const LOG_TABLES = `
  FROM payment_logs pl
  LEFT JOIN orders o ON pl.order_id = o.id
  LEFT JOIN users u ON o.user_id = u.id
  LEFT JOIN addresses a ON o.shipping_address_id = a.id
`;

export const getPaymentStatus = async (reference) => {
  const result = await db.query(
    `SELECT
        o.id,
        o.status as payment_status,
        o.payment_method,
        o.payment_ref as payment_reference,
        o.order_status,
        o.total as total_amount,
        o.placed_at,
        o.user_id,
        u.name as customer_name,
        u.email as customer_email,
        COUNT(oi.id) as item_count
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN order_items oi ON o.id = oi.order_id
    WHERE o.payment_ref = $1
    GROUP BY o.id, u.name, u.email`,
    [reference]
  );

  if (result.rows.length === 0) {
    throw new HttpError(404, "Payment reference not found");
  }

  const logs = await db.query(
    `SELECT status, processed_by, created_at, failure_reason, gateway_response
    FROM payment_logs
    WHERE payment_reference = $1
    ORDER BY created_at DESC
    LIMIT 10`,
    [reference]
  );

  return {
    ...result.rows[0],
    payment_logs: logs.rows,
    last_updated: new Date().toISOString(),
  };
};

const checkDate = (date) => {
  if (date && !isValidDateFormat(date)) {
    throw new HttpError(400, "Invalid date format. Please use YYYY-MM-DD format.", {
      example: "2024-01-15",
    });
  }
};

const formatLog = (log) => ({
  id: log.id,
  order_id: log.order_id,
  payment_reference: log.payment_reference,
  status: log.status,
  amount: log.amount,
  payment_method: log.payment_method,
  processed_by: log.processed_by,
  created_at: log.created_at,
  customer: {
    id: log.user_id,
    email: log.customer_email,
    name: log.customer_name,
  },
  order: {
    status: log.order_status,
    total: log.order_total,
    shipping_location:
      log.shipping_city && log.shipping_country ? `${log.shipping_city}, ${log.shipping_country}` : null,
  },
  failure_reason: log.failure_reason,
  gateway_response: log.gateway_response,
});

export const getPaymentLogs = async (query) => {
  const { page = 1, limit = 20, status, payment_method, order_id, date_from, date_to, search } = query;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  checkDate(date_from);
  checkDate(date_to);

  const conditions = ["1 = 1"];
  const params = [];
  const addCondition = (sql, value) => {
    params.push(value);
    conditions.push(sql.replaceAll("?", `$${params.length}`));
  };

  if (status) addCondition("pl.status = ?", status);
  if (payment_method) addCondition("pl.payment_method = ?", payment_method);
  if (order_id) addCondition("pl.order_id = ?", order_id);
  if (date_from) addCondition("pl.created_at >= ?", date_from);
  if (date_to) addCondition("pl.created_at < ?", getNextDayString(date_to));
  if (search) addCondition("(pl.payment_reference ILIKE ? OR u.email ILIKE ?)", `%${search}%`);

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const [logsResult, countResult, statsResult] = await Promise.all([
    db.query(
      `SELECT
        pl.id,
        pl.order_id,
        pl.payment_reference,
        pl.status,
        pl.amount,
        pl.payment_method,
        pl.processed_by,
        pl.failure_reason,
        pl.gateway_response,
        pl.created_at,
        o.user_id,
        o.order_status,
        o.total as order_total,
        u.email as customer_email,
        u.name as customer_name,
        a.city as shipping_city,
        a.country as shipping_country
      ${LOG_TABLES}
      ${whereClause}
      ORDER BY pl.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limitNum, offset]
    ),
    db.query(`SELECT COUNT(*) as total ${LOG_TABLES} ${whereClause}`, params),
    db.query(
      `SELECT
        COUNT(*) as total_transactions,
        SUM(CASE WHEN pl.status = 'paid' THEN pl.amount ELSE 0 END) as total_successful_amount,
        COUNT(CASE WHEN pl.status = 'paid' THEN 1 END) as successful_transactions,
        COUNT(CASE WHEN pl.status = 'failed' THEN 1 END) as failed_transactions,
        COUNT(CASE WHEN pl.status = 'pending' THEN 1 END) as pending_transactions,
        COUNT(CASE WHEN pl.status = 'cancelled' THEN 1 END) as cancelled_transactions,
        COUNT(CASE WHEN pl.status = 'refunded' THEN 1 END) as refunded_transactions
      ${LOG_TABLES}
      ${whereClause}`,
      params
    ),
  ]);

  const totalRecords = parseInt(countResult.rows[0].total);
  const totalPages = Math.ceil(totalRecords / limitNum);
  const stats = statsResult.rows[0];

  return {
    logs: logsResult.rows.map(formatLog),
    pagination: {
      current_page: pageNum,
      total_pages: totalPages,
      total_records: totalRecords,
      per_page: limitNum,
      has_next_page: pageNum < totalPages,
      has_prev_page: pageNum > 1,
    },
    statistics: {
      total_transactions: parseInt(stats.total_transactions),
      successful_transactions: parseInt(stats.successful_transactions),
      failed_transactions: parseInt(stats.failed_transactions),
      pending_transactions: parseInt(stats.pending_transactions),
      cancelled_transactions: parseInt(stats.cancelled_transactions),
      refunded_transactions: parseInt(stats.refunded_transactions),
      total_successful_amount: parseFloat(stats.total_successful_amount),
      success_rate:
        stats.total_transactions > 0
          ? ((stats.successful_transactions / stats.total_transactions) * 100).toFixed(2)
          : 0,
    },
    filters_applied: {
      status: status || null,
      payment_method: payment_method || null,
      order_id: order_id || null,
      date_range: {
        from: date_from || null,
        to: date_to || null,
      },
      search: search || null,
    },
  };
};

export const getPaymentAnalytics = async (period = "30d") => {
  // Looked up from a fixed list, because the interval goes straight into the SQL
  const interval = ANALYTICS_PERIODS[period];
  const dateFilter = interval ? `AND pl.created_at >= NOW() - INTERVAL '${interval}'` : "";

  const [daily, methods] = await Promise.all([
    db.query(`
      SELECT
        DATE_TRUNC('day', pl.created_at) as date,
        COUNT(*) as total_transactions,
        COUNT(CASE WHEN pl.status = 'paid' THEN 1 END) as successful_transactions,
        SUM(CASE WHEN pl.status = 'paid' THEN amount ELSE 0 END) as daily_revenue,
        AVG(CASE WHEN pl.status = 'paid' THEN amount END) as avg_transaction_value
      FROM payment_logs pl
      WHERE 1=1 ${dateFilter}
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date DESC
    `),
    db.query(`
      SELECT
        payment_method,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'paid' THEN amount END) as total_amount
      FROM payment_logs pl
      WHERE status = 'paid' ${dateFilter}
      GROUP BY payment_method
      ORDER BY total_amount DESC
    `),
  ]);

  return {
    daily_analytics: daily.rows,
    payment_methods: methods.rows,
    period,
  };
};
