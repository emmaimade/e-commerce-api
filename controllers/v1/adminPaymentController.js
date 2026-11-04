import db from "../../config/db.js";
import { getNextDayString, isValidDateFormat } from "../../utils/dateHelpers.js";

export const getPaymentStatusAdmin = async (req, res) => {
  try {
    const { reference } = req.params;

    // Input validation
    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference is required",
      });
    }

    const query = `
      SELECT
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
      WHERE o.payment_ref =$1
      GROUP BY o.id, u.name, u.email
    `;

    const result = await db.query(query, [reference]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment reference not found",
      });
    }

    const orderData = result.rows[0];

    // Get payment logs for this reference
    const logsQuery = `
      SELECT
          status,
          processed_by,
          created_at,
          failure_reason,
          gateway_response
      FROM payment_logs
      WHERE payment_reference = $1
      ORDER BY created_at DESC
      LIMIT 10
    `;

    const logsResult = await db.query(logsQuery, [reference]);

    // No cache for admin queries
    res.set("Cache-Control", "no-cache");

    res.status(200).json({
      success: true,
      data: {
        ...orderData,
        payment_logs: logsResult.rows,
        last_updated: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("Error getting payment status (admin):", err);
    res.status(500).json({
      success: false,
      message: "Failed to get payment status",
    });
  }
};

export const getPaymentLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      payment_method,
      order_id,
      date_from,
      date_to,
      search,
    } = req.query;

    // Validate pagination parameters
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    // Build dynamic query
    let whereClause = "WHERE 1 = 1";
    const queryParams = [];
    let paramIndex = 1;

    // Filter by status
    if (status) {
      whereClause += ` AND pl.status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    // Filter by payment method
    if (payment_method) {
      whereClause += ` AND pl.payment_method = $${paramIndex}`;
      queryParams.push(payment_method);
      paramIndex++;
    }

    // Filter by order ID
    if (order_id) {
      whereClause += ` AND pl.order_id = $${paramIndex}`;
      queryParams.push(order_id);
      paramIndex++;
    }

    // Validate dates first
    if (date_from && !isValidDateFormat(date_from)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Please use YYYY-MM-DD format.",
        example: "2024-01-15"
      })
    }

    if (date_to && !isValidDateFormat(date_to)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Please use YYYY-MM-DD format.",
        example: "2024-01-15"
      })
    }

    // Filter by date range
    if (date_from && date_to) {
      const nextDayString = getNextDayString(date_to);
      console.log(nextDayString);

      whereClause += ` AND pl.created_at >= $${paramIndex} AND pl.created_at < $${paramIndex + 1}`;
      queryParams.push(date_from, nextDayString);
      paramIndex += 2;
    } else if (date_from) {
      whereClause += ` AND pl.created_at >= $${paramIndex}`;
      queryParams.push(date_from);
      paramIndex++;
    } else if (date_to) {
      const nextDayString = getNextDayString(date_to);
      console.log(nextDayString);

      whereClause += ` AND pl.created_at <= $${paramIndex}`;
      queryParams.push(nextDayString);
      paramIndex++;
    }

    // Search functionality (payment_reference, customer email)
    if (search) {
      whereClause += ` AND (
        pl.payment_reference ILIKE $${paramIndex} OR 
        u.email ILIKE $${paramIndex}
      )`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // Build payment logs query
    const logsQuery = `
      SELECT
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
      FROM payment_logs pl
      LEFT JOIN orders o ON pl.order_id = o.id
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      ${whereClause}
      ORDER BY pl.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(limitNum, offset);

    // Count query for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM payment_logs pl
      LEFT JOIN orders o ON pl.order_id = o.id
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      ${whereClause}
    `;

    const countParams = queryParams.slice(0, -2); // Exclude limit and offset

    // Execute both queries
    const [logsResult, countResult] = await Promise.all([
      db.query(logsQuery, queryParams),
      db.query(countQuery, countParams),
    ]);

    const logs = logsResult.rows;
    const totalRecords = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalRecords / limitNum);

    // Calculate Summary statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_transactions,
        SUM(CASE WHEN pl.status = 'paid' THEN pl.amount ELSE 0 END) as total_successful_amount,
        COUNT(CASE WHEN pl.status = 'paid' THEN 1 END) as successful_transactions,
        COUNT(CASE WHEN pl.status = 'failed' THEN 1 END) as failed_transactions,
        COUNT(CASE WHEN pl.status = 'pending' THEN 1 END) as pending_transactions,
        COUNT(CASE WHEN pl.status = 'cancelled' THEN 1 END) as cancelled_transactions,
        COUNT(CASE WHEN pl.status = 'refunded' THEN 1 END) as refunded_transactions
      FROM payment_logs pl
      LEFT JOIN orders o ON pl.order_id = o.id
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      ${whereClause}
    `;
    
    const statsResult = await db.query(statsQuery, countParams);
    const stats = statsResult.rows[0];

    // Format response
    const formattedLogs = logs.map((log) => ({
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
        name: log.customer_name
      },
      order: {
        status: log.order_status,
        total: log.order_total,
        shipping_location: log.shipping_city && log.shipping_country ? `${log.shipping_city}, ${log.shipping_country}` : null
      },
      failure_reason: log.failure_reason,
      gateway_response: log.gateway_response,
    }));

    res.status(200).json({
      success: true,
      data: {
        logs: formattedLogs,
        pagination: {
          current_page: pageNum,
          total_pages: totalPages,
          total_records: totalRecords,
          per_page: limitNum,
          has_next_page: pageNum < totalPages,
          has_prev_page: pageNum > 1
        },
        statistics: {
          total_transactions: parseInt(stats.total_transactions),
          successful_transactions: parseInt(stats.successful_transactions),
          failed_transactions: parseInt(stats.failed_transactions),
          pending_transactions: parseInt(stats.pending_transactions),
          cancelled_transactions: parseInt(stats.cancelled_transactions),
          refunded_transactions: parseInt(stats.refunded_transactions),
          total_successful_amount: parseFloat(stats.total_successful_amount),
          success_rate: stats.total_transactions > 0 ? ((stats.successful_transactions / stats.total_transactions) * 100 ).toFixed(2): 0
        },
        filters_applied: {
          status: status || null,
          payment_method: payment_method || null,
          order_id: order_id || null,
          date_range: {
            from: date_from || null,
            to: date_to || null
          },
          search: search || null,
        }
      }
    })
  } catch (err) {
    console.error("Error fetching payment logs:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch payment logs",
    });
  }
};

export const getPaymentAnalytics = async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    let dateFilter = ''; 
    if (period === '7d') {
      dateFilter = "AND pl.created_at >= NOW() - INTERVAL '7 days'";
    } else if (period === '30d') {
      dateFilter = "AND pl.created_at >= NOW() - INTERVAL '30 days'";
    } else if (period === '90d') {
      dateFilter = "AND pl.created_at >= NOW() - INTERVAL '90 days'";
    } else if (period === '1y') {
      dateFilter = "AND pl.created_at >= NOW() - INTERVAL '1 year'";
    }

    // Revenue analytics
    const analyticsQuery = `
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
    `;

    // Payment method
    const methodQuery = `
      SELECT
        payment_method,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'paid' THEN amount END) as total_amount
      FROM payment_logs pl
      WHERE status = 'paid' ${dateFilter}
      GROUP BY payment_method
      ORDER BY total_amount DESC
    `;

    const [analyticsResult, methodResult] = await Promise.all([
      db.query(analyticsQuery),
      db.query(methodQuery)
    ]);

    res.status(200).json({
      success: true,
      data: {
        daily_analytics: analyticsResult.rows,
        payment_methods: methodResult.rows,
        period: period
      }
    });
  } catch (err) {
    console.error("Error fetching payment analytics:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment analytics",
    });
  }
}
