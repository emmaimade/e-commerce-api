import * as cartService from "../../services/cartService.js";

export const addToCart = async (req, res) => {
  await cartService.addItem(req.user.id, req.body);

  res.status(200).json({
    success: true,
    message: "Product added to cart successfully",
  });
};

export const getCart = async (req, res) => {
  const cart = await cartService.getCart(req.user.id);

  res.json({
    success: true,
    data: cart,
  });
};

export const updateItemQty = async (req, res) => {
  const itemId = req.params.id;
  const { quantity } = req.body;

  const itemTotal = await cartService.updateItemQuantity(req.user.id, itemId, quantity);

  res.status(200).json({
    success: true,
    message: "Cart updated successfully",
    data: {
      item_id: itemId,
      quantity,
      item_total: itemTotal,
    },
  });
};

export const deleteItem = async (req, res) => {
  const itemId = req.params.id;

  const { item, cartEmpty } = await cartService.removeItem(req.user.id, itemId);

  res.status(200).json({
    success: true,
    message: `${item.name} removed from cart`,
    data: {
      deleted_item_id: itemId,
      cart_id: item.cart_id,
      cart_empty: cartEmpty,
      deleted_item: {
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      },
    },
  });
};

export const clearCart = async (req, res) => {
  const deletedCount = await cartService.clearCart(req.user.id);

  res.status(200).json({
    success: true,
    message: `Cleared ${deletedCount} ${deletedCount === 1 ? "item" : "items"} from cart`,
    data: {
      deleted_count: deletedCount,
      cleared_at: new Date().toISOString(),
    },
  });
};
