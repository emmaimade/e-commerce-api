import db from "../../config/db.js";

export const getProducts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    // Search and filter parmeters
    const {
      search,
      min_price,
      max_price,
      sort_by = "created_at",
      sort_order = "desc",
    } = req.query;

    // Build dynamic query
    let whereConditions = ["status = active"];
    let queryParams = [];
    let paramCount = 0;

    // Search functionality
    if (search && search.trim()) {
      paramCount++;
      whereConditions.push(
        `(name ILIKE $${paramCount} OR description  ILIKE $${paramCount})`
      );
      queryParams.push(`%${search.trim()}%`);
    }

    // Price range filters
    if (min_price && !isNaN(min_price)) {
      paramCount++;
      whereConditions.push(`price >= $${paramCount}`);
      queryParams.push(parseFloat(min_price));
    }

    if (max_price && !isNaN(max_price)) {
      paramCount++;
      whereConditions.push(`price <= $${paramCount}`);
      queryParams.push(parseFloat(max_price));
    }

    // Validate sort parameters
    const allowedSortFields = ["name", "price", "created_at", "updated_at"];
    const allowedSortOrders = ["ASC", "DESC"];
    const sortField = allowedSortFields.includes(sort_by)
      ? sort_by
      : "created_at";
    const sortDirection = allowedSortOrders.includes(sort_order)
      ? sort_order
      : "DESC";

    const whereClause = whereConditions.join(" AND ");

    // Get total count for pagination
    const countQuery = `SELECT COUNT(*) as total FROM products WHERE ${whereClause}`;
    const countResult = await db.query(countQuery, queryParams);
    const totalProducts = parseInt(countResult.rows[0].total);

    // Calculate pagination
    const totalPages = Math.ceil(totalProducts / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    // Get products with search, filters and sorting
    const productsQuery = `
      SELECT * FROM products
      WHERE ${whereClause}
      ORDER BY ${sortField} ${sortDirection}
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    queryParams.push(limit, offset);
    const products = await db.query(productsQuery, queryParams);

    if (products.rows.length === 0) {
      return res.status(404).json({ message: "No products found" });
    }

    // Set cache headers
    const cacheTime = search || min_price || max_price ? 60 : 300; // 1 min for filtered, 5 min for all
    res.set("Cache-Control", `public, max-age=${cacheTime}`);

    res.status(200).json({
      success: true,
      data: {
        products: products.rows,
        filters: {
          search: search || null,
          min_price: min_price || null,
          max_price: max_price || null,
          sort_by: sortField || null,
          sort_order: sortDirection || null,
        },
        pagination: {
          current_page: page,
          per_page: limit,
          total_items: totalProducts,
          total_pages: totalPages,
          has_next_page: hasNextPage,
          has_prev_page: hasPrevPage,
          next_page: hasNextPage ? page + 1 : null,
          prev_page: hasPrevPage ? page - 1 : null,
        },
      },
    });
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
      error: err.message,
    });
  }
};

export const getProduct = async (req, res) => {
  try {
    const productId = req.params.id;

    if (!productId || isNaN(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const product = await db.query("SELECT * FROM products WHERE id = $1", [
      productId,
    ]);
    if (product.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Set cache headers
    res.set("Cache-Control", "public, max-age=1800"); // 30 min

    res.status(200).json({
      success: true,
      data: {
        product: product.rows[0],
      },
    });
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch product",
      error: err.message,
    });
  }
};
