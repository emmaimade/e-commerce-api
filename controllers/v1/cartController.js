import db from "../../config/db.js";

export const addToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, quantity } = req.body;

    // checks if quantity is a number
    if (isNaN(quantity)) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a number",
      });
    }

    // checks if quantity is greater than 0
    if (quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be greater than 0",
      });
    }

    // checks if product exists
    const product = await db.query("SELECT * from products WHERE id = $1", [
      productId,
    ]);
    if (product.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // checks if quantity is less than inventory
    if (product.rows[0].inventory_qty < quantity) {
      return res.status(400).json({
        success: false,
        message: "Quantity exceeds available inventory",
        available: product.rows[0].inventory_qty,
      });
    }

    // checks if user has a cart already and if not create one
    const cart = await db.query("SELECT id FROM carts WHERE user_id = $1", [
      userId,
    ]);

    let cartId;

    if (cart.rows.length === 0) {
      const newCart = await db.query(
        "INSERT INTO carts (user_id) VALUES ($1) RETURNING id",
        [userId]
      );

      cartId = newCart.rows[0].id;
    } else {
      cartId = cart.rows[0].id;
    }

    // checks if product already exists in cart
    const existingItem = await db.query(
      "SELECT * FROM cart_items WHERE cart_id = $1 AND product_id = $2",
      [productId, cartId]
    );

    if (existingItem.rows.length > 0) {
      await db.query(
        "UPDATE cart_items SET quantity = quantity + $1 WHERE id = $2",
        [quantity, existingItem.rows[0].id]
      );
    } else {
      // add product to cart_items
      await db.query(
        "INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)",
        [cartId, productId, quantity]
      );
    }

    // update timestamp
    await db.query("UPDATE carts SET updated_at = NOW() WHERE id = $1", [
      cartId,
    ]);

    res.status(200).json({
      success: true,
      message: "Product added to cart successfully",
    });
  } catch (err) {
    console.log("Add to cart error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message,
    });
  }
};

export const getCart = async (req, res) => {
  try {
    const userId = req.user.id;

    const query = `
        SELECT 
        c.id as cart_id, 
        c.created_at as cart_created_at, 
        c.updated_at as cart_updated_at, 
        ci.id as item_id, 
        ci.quantity, 
        ci.added_at, 
        p.id as product_id, 
        p.name, 
        p.price, 
        p.images, 
        (ci.quantity * p.price) as item_total 
        FROM carts c 
        LEFT JOIN cart_items ci ON c.id = ci.cart_id 
        LEFT JOIN products p ON ci.product_id = p.id 
        WHERE c.user_id = $1 
        ORDER BY ci.added_at DESC
    `;

    const result = await db.query(query, [userId]);

    if (result.rows.length === 0) {
      // User has no cart yet
      return res.json({
        success: true,
        data: {
          cart_id: null,
          items: [],
          total_items: 0,
          total_amount: 0,
        },
      });
    }

    const hasItems = result.rows[0].item_id !== null;

    const cart = {
      cart_id: result.rows[0].cart_id,
      created_at: result.rows[0].cart_created_at,
      updated_at: result.rows[0].cart_updated_at,
      items: [],
      total_items: 0,
      total_amount: 0,
    };

    if (hasItems) {
      result.rows.forEach((item) => {
        cart.items.push({
          item_id: item.item_id,
          product_id: item.product_id,
          product_name: item.name,
          product_price: parseFloat(item.price),
          product_images: item.images,
          quantity: parseInt(item.quantity),
          item_total: parseFloat(item.item_total),
          added_at: item.added_at,
        });

        cart.total_items += parseInt(item.quantity);
        cart.total_amount += parseFloat(item.item_total);
      });
    }

    res.json({
      success: true,
      data: cart,
    });
  } catch (err) {
    console.log("Get cart error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server Error", 
      error: err.message
    });
  }
};

export const updateItemQty = async (req, res) => {
  try {
    const userId = req.user.id;
    const itemId = req.params.id;
    const quantity = parseInt(req.body.quantity);

    if (!quantity || quantity < 1 || quantity > 99) {
      return res.status(400).json({
        success: false,
        error: "Quantity must be between 1 and 99",
      });
    }

    // checks if item belongs to user cart
    const query = `
            SELECT
            ci.id, ci.cart_id, p.inventory_qty, p.name, p.price
            FROM cart_items ci
            JOIN carts c ON ci.cart_id = c.id
            JOIN products p ON ci.product_id = p.id
            WHERE ci.id = $1 AND c.user_id = $2
        `;

    const result = await db.query(query, [itemId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: true,
        error: "Cart item not found",
      });
    }

    const item = result.rows[0];

    // check product availability
    if (quantity > item.inventory_qty) {
      return res.status(400).json({
        success: false,
        error: `Only ${item.inventory_qty} items available in stock`,
      });
    }

    // update quantity
    const updateQuery = `
        UPDATE cart_items
        SET quantity = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *
    `;
    await db.query(updateQuery, [quantity, itemId]);

    // calculate new item total
    const newItemTotal = quantity * parseFloat(item.price);

    res.status(200).json({
      success: true,
      message: "Cart updated successfully",
      data: {
        item_id: itemId,
        quantity: quantity,
        item_total: newItemTotal,
      },
    });
  } catch (err) {
    console.log("Error updating item quantity", err.message);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message,
    });
  }
};

export const deleteItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const itemId = req.params.id;

    // check if items exist and belong to user's cart
    const checkQuery = `
            SELECT
            ci.id, ci.cart_id, ci.quantity, p.name, p.price
            FROM cart_items ci
            JOIN carts c ON ci.cart_id = c.id
            JOIN products p ON ci.product_id = p.id
            WHERE ci.id = $1 AND c.user_id = $2
        `;

    const checkResult = await db.query(checkQuery, [itemId, userId]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Cart item not found or unauthorized",
      });
    }

    const item = checkResult.rows[0];

    // delete item
    await db.query("DELETE FROM cart_items WHERE id = $1", [itemId]);

    // update cart timestamp
    await db.query("UPDATE carts SET updated_at = NOW() WHERE id = $1", [
      item.cart_id,
    ]);

    // check if cart is now empty
    const remainingItemsResult = await db.query(
      "SELECT COUNT(*) as count FROM cart_items WHERE cart_id = $1",
      [item.cart_id]
    );

    const isCartEmpty = parseInt(remainingItemsResult.rows[0].count) === 0;

    res.status(200).json({
      success: true,
      message: `${item.name} removed from cart`,
      data: {
        deleted_item_id: itemId,
        cart_id: item.cart_id,
        cart_empty: isCartEmpty,
        deleted_item: {
          name: item.name,
          price: item.price,
          quantity: item.quantity,
        },
      },
    });
  } catch (err) {
    console.log("Error deleting item: ", err.message);
    res.status(500).json({
      success: false,
      error: "Server Error",
    });
  }
};
