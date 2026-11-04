const statusMessages = {
  processing: "Your order is being prepared for shipment.",
  shipped: "Your order has been shipped and is on its way to you!",
  delivered: "You order has been successfully delivered. We hope you love it!",
  cancelled: "Your order has been cancelled. If you have questions, please contact our support team."
};

const statusColors = {
  processing: "#ffc107",
  shipped: "#17a2b8", 
  delivered: "#28a745",
  cancelled: "#dc3545"
};

const statusEmojis = {
  processing: "⚙️",
  shipped: "🚚",
  delivered: "✅",
  cancelled: "❌"
};

export const orderConfirmationEmail = ({ user, order, total, items, paymentUrl }) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="text-align: center; border-bottom: 2px solid #007bff; padding-bottom: 20px; margin-bottom: 30px;">
      <h1 style="color: #333; margin: 0;">📦 Order Confirmation</h1>
      <p style="color: #666; margin: 5px 0;">Your order has been received and is awaiting payment</p>
    </div>

    <!-- Greeting -->
    <p style="font-size: 16px;">Hi ${user.name || "Valued Customer"},</p>
    <p>Thank you for your order! We've received your order details and reserved your items. Please complete your payment to secure your purchase.</p>
    
    <!-- Payment Alert Banner -->
    <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
      <strong>⏰ Payment Required</strong><br>
      <span style="font-size: 14px;">Complete your payment within 24 hours to secure your order</span>
    </div>

    <!-- Order Details Card -->
    <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; border-left: 4px solid #007bff;">
      <h3 style="margin-top: 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Order Details</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Order ID:</td>
          <td style="padding: 10px 0; color: #007bff; font-weight: bold;">#${
            order.id
          }</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Order Status:</td>
          <td style="padding: 10px 0;">
            <span style="background-color: #ffc107; color: #000; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">
              PENDING PAYMENT
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Order Date:</td>
          <td style="padding: 10px 0;">${new Date().toLocaleDateString(
            "en-US",
            {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }
          )}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Total Amount:</td>
          <td style="padding: 10px 0; font-size: 18px; color: #28a745; font-weight: bold;">
            ₦${total.toLocaleString()}
          </td>
        </tr>
      </table>
    </div>

    <!-- Items Ordered Section -->
    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0;">
      <h3 style="margin-top: 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Items Ordered</h3>
      <div style="max-height: 300px; overflow-y: auto;">
        ${items
          .map(
            (item) => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #eee;">
                <div style="flex: 1;">
                  <strong style="color: #333;">${item.name}</strong><br>
                  <span style="color: #666; font-size: 14px;">Quantity: ${
                    item.quantity
                  }</span>
                </div>
                <div style="text-align: right; font-weight: bold; color: #007bff;">
                  ₦${(item.price * item.quantity).toLocaleString()}
                </div>
              </div>
            `
          )
          .join("")}
      </div>
      
      <!-- Order Summary -->
      <div style="margin-top: 20px; padding-top: 15px; border-top: 2px solid #007bff;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="font-size: 16px;">Total:</strong>
          <strong style="font-size: 18px; color: #28a745;">₦${total.toLocaleString()}</strong>
        </div>
      </div>
    </div>

    <!-- Payment Link Section -->
    <div style="background-color: #e8f4f8; padding: 25px; border-radius: 10px; margin: 25px 0; text-align: center; border: 2px dashed #007bff;">
      <h3 style="color: #2c5aa0; margin-top: 0;">💳 Complete Your Payment</h3>
      <p style="margin-bottom: 20px; color: #555;">Click the button below to complete your payment securely with Paystack:</p>
      <a href="${paymentUrl}" 
        style="display: inline-block; background-color: #007bff; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 10px 0; font-size: 16px; transition: background-color 0.3s;">
        🔒 Pay Securely - ₦${total.toLocaleString()}
      </a>
      <div style="margin-top: 15px; padding: 10px; background-color: #fff; border-radius: 5px;">
        <p style="font-size: 12px; color: #666; margin: 0;">
          🛡️ <strong>Secure Payment:</strong> Your payment is protected by 256-bit SSL encryption<br>
          ⏰ <strong>Expires:</strong> This payment link will expire in 24 hours
        </p>
      </div>
    </div>

    <!-- Important Information -->
    <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 8px; margin: 25px 0;">
      <h4 style="margin-top: 0; color: #0c5460;">📋 Important Information</h4>
      <ul style="margin: 10px 0; padding-left: 20px; color: #0c5460; line-height: 1.6;">
        <li>Your items have been reserved and will be held for 24 hours</li>
        <li>You'll receive a payment confirmation email once payment is completed</li>
        <li>Your order will be processed immediately after payment confirmation</li>
        <li>Estimated processing time: 1-2 business days after payment</li>
      </ul>
    </div>

    <!-- Support Section -->
    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0;">
      <h4 style="margin-top: 0; color: #333;">Need Help? 🤝</h4>
      <p style="margin-bottom: 10px;">Our customer support team is here to help:</p>
      <ul style="list-style: none; padding-left: 0;">
        <li style="margin: 8px 0;">📧 <strong>Email:</strong> ${
          process.env.EMAIL_USER
        }</li>
        <li style="margin: 8px 0;">📞 <strong>Phone:</strong> ${process.env.SUPPORT_PHONE || '+234-XXX-XXXX-XXX'}</li>
        <li style="margin: 8px 0;">💬 <strong>Live Chat:</strong> Available on our website</li>
      </ul>
      <p style="font-size: 14px; color: #666; margin-bottom: 0;">
        Please reference Order ID <strong>#${
          order.id
        }</strong> when contacting support.
      </p>
    </div>

    <!-- Track Order Section -->
    <div style="text-align: center; margin: 30px 0;">
      <p>Want to track your order?</p>
      <a href="${process.env.BASE_URL}/v1/order/${order.id}/history" 
        style="display: inline-block; background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
        📍 Track Your Order
      </a>
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding-top: 30px; border-top: 1px solid #ddd; margin-top: 40px;">
      <p style="font-size: 18px; margin-bottom: 10px;">Thank you for choosing us! 🛍️</p>
      <p style="color: #666; margin-bottom: 20px;">
        Best regards,<br>
        <strong>The E-commerce API Team</strong>
      </p>
      
      <!-- Email Footer -->
      <div style="font-size: 12px; color: #999; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
        <p>This email was sent to <strong>${user.email}</strong></p>
        <p>© 2024 E-commerce API. All rights reserved.</p>
        <p>If you didn't place this order, please contact us immediately.</p>
      </div>
    </div>
  </div>
`;

export const orderStatusEmail = ({ status, currentOrder, previousStatus, orderId, notes }) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="text-align: center; border-bottom: 2px solid ${statusColors[status] || '#007bff'}; padding-bottom: 20px; margin-bottom: 30px;">
      <h1 style="color: #333; margin: 0;">${statusEmojis[status] || '📦'} Order Status Update</h1>
      <p style="color: #666; margin: 5px 0;">Your order status has been updated</p>
    </div>

    <!-- Greeting -->
    <p style="font-size: 16px;">Hi ${currentOrder.name || "Valued Customer"},</p>
    <p>We wanted to keep you updated on your order. The status has been updated from <strong>${previousStatus.toUpperCase()}</strong> to <strong>${status.toUpperCase()}</strong>.</p>
    
    <!-- Status Banner -->
    <div style="background-color: ${statusColors[status] || '#007bff'}; color: white; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
      <h2 style="margin: 0; text-transform: uppercase;">${statusEmojis[status] || '📦'} ${status}</h2>
    </div>

    <!-- Order Details Card -->
    <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; border-left: 4px solid ${statusColors[status] || '#007bff'};">
      <h3 style="margin-top: 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Order Details</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Order ID:</td>
          <td style="padding: 10px 0; color: #007bff; font-weight: bold;">#${orderId}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Order Total:</td>
          <td style="padding: 10px 0; font-size: 16px; font-weight: bold;">₦${currentOrder.total.toLocaleString()}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Status:</td>
          <td style="padding: 10px 0;">
            <span style="background-color: ${statusColors[status] || '#007bff'}; color: white; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">
              ${status.toUpperCase()}
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Updated:</td>
          <td style="padding: 10px 0;">${new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric", 
            hour: "2-digit",
            minute: "2-digit",
          })}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Updated By:</td>
          <td style="padding: 10px 0; color: #dc3545; font-weight: bold;">Admin Team</td>
        </tr>
        ${notes ? `
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555; vertical-align: top;">Notes:</td>
          <td style="padding: 10px 0; background-color: #fff3cd; padding: 8px 12px; border-radius: 4px; border-left: 3px solid #ffc107;">${notes}</td>
        </tr>
        ` : ''}
      </table>
    </div>

    <!-- Status Message -->
    <div style="background-color: #e8f4f8; padding: 20px; border-radius: 8px; margin: 25px 0;">
      <p style="margin: 0; font-size: 16px; line-height: 1.6; text-align: center;">
        ${statusMessages[status] || 'Your order status has been updated.'}
      </p>
    </div>

    ${status === 'shipped' ? ` 
    <!-- Shipping Info (if shipped) --> 
    <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; padding: 20px; border-radius: 8px; margin: 25px 0;"> 
      <h4 style="margin-top: 0; color: #0c5460;">🚚 Shipping Information</h4> 
      <p style="margin-bottom: 10px;">Your order is on its way! You can track your shipment using the tracking information that will be provided separately.</p> 
      <p style="margin-bottom: 15px; font-size: 14px; color: #0c5460;"> 
        <strong>Estimated delivery:</strong> 3-5 business days 
      </p>
      
      <!-- Order History Button -->
      <div style="text-align: center; margin-top: 20px;">
        <a href="${process.env.BASE_URL}/v1/order/${orderId}/history" 
          style="display: inline-block; 
                  background-color: #17a2b8; 
                  color: white; 
                  padding: 10px 20px; 
                  text-decoration: none; 
                  border-radius: 5px; 
                  font-weight: bold; 
                  transition: background-color 0.3s ease;
                  border: none;
                  cursor: pointer;"
          onmouseover="this.style.backgroundColor='#138496'" 
          onmouseout="this.style.backgroundColor='#17a2b8'">
          📋 View Order History
        </a>
      </div>
    </div> 
    ` : ''}

    ${status === 'delivered' ? `
    <!-- Delivery Confirmation -->
    <div style="background-color: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 8px; margin: 25px 0;">
      <h4 style="margin-top: 0; color: #155724;">🎉 Delivery Confirmed!</h4>
      <p style="margin-bottom: 15px;">We hope you're happy with your purchase! If you have a moment, we'd love to hear about your experience.</p>
      <div style="text-align: center;">
        <a href="#" style="display: inline-block; background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
          Leave a Review
        </a>
      </div>
    </div>
    ` : ''}

    ${status === 'cancelled' ? `
    <!-- Cancellation Info -->
    <div style="background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 8px; margin: 25px 0;">
      <h4 style="margin-top: 0; color: #721c24;">Order Cancellation</h4>
      <p style="margin-bottom: 10px;">If a payment was processed, the refund will be credited back to your original payment method within 5-7 business days.</p>
      <p style="margin-bottom: 0;">If you have any questions about this cancellation, please don't hesitate to contact our support team.</p>
    </div>
    ` : ''}

    <!-- Support Section -->
    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0;">
      <h4 style="margin-top: 0; color: #333;">Need Help? 🤝</h4>
      <p style="margin-bottom: 10px;">Questions about your order? We're here to help:</p>
      <ul style="list-style: none; padding-left: 0;">
        <li style="margin: 8px 0;">📧 <strong>Email:</strong> ${process.env.EMAIL_USER}</li>
        <li style="margin: 8px 0;">📞 <strong>Phone:</strong> ${process.env.SUPPORT_PHONE || '+234-XXX-XXXX-XXX'}</li>
        <li style="margin: 8px 0;">💬 <strong>Live Chat:</strong> Available on our website</li>
      </ul>
      <p style="font-size: 14px; color: #666; margin-bottom: 0;">
        Please reference Order ID <strong>#${orderId}</strong> when contacting support.
      </p>
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding-top: 30px; border-top: 1px solid #ddd; margin-top: 40px;">
      <p style="font-size: 18px; margin-bottom: 10px;">Thank you for shopping with us! 🛍️</p>
      <p style="color: #666; margin-bottom: 20px;">
        Best regards,<br>
        <strong>The E-commerce API Team</strong>
      </p>
      
      <!-- Email Footer -->
      <div style="font-size: 12px; color: #999; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
        <p>This email was sent to <strong>${currentOrder.email}</strong></p>
        <p>© 2024 E-commerce API. All rights reserved.</p>
      </div>
    </div>
  </div>
`;

// The refund section of the cancellation email, based on what Paystack reported
const refundNotice = ({ refundProcessed, refundData, refundError }) => {
    let refundMessage = "";
    let refundStatusBadge = "";
    let refundIcon = "";

    if (refundProcessed) {
      if (refundData.status === "processed") {
        refundIcon = "✅";
        refundStatusBadge = `<span style="background-color: #d4edda; color: #155724; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">REFUND PROCESSED</span>`;
        refundMessage = `
          <div style="background-color: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <strong>💰 Refund Successfully Processed</strong>
            <p style="margin: 10px 0 0 0;">Your refund has been processed successfully and should reflect in your account within 1-3 working days depending on your bank.</p>
          </div>`;
      } else if (refundData.status === "pending") {
        refundIcon = "⏳";
        refundStatusBadge = `<span style="background-color: #fff3cd; color: #856404; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">REFUND PENDING</span>`;
        refundMessage = `
          <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <strong>⏳ Refund In Progress</strong>
            <p style="margin: 10px 0 0 0;">A refund has been initiated and is being processed. You should receive your refund within 5-7 working days.</p>
          </div>`;
      } else if (refundData.status === "already_processed") {
        refundIcon = "✅";
        refundStatusBadge = `<span style="background-color: #d4edda; color: #155724; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">ALREADY REFUNDED</span>`;
        refundMessage = `
          <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; color: #0c5460; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <strong>ℹ️ Refund Already Processed</strong>
            <p style="margin: 10px 0 0 0;">This transaction was already fully reversed. If you don't see the refund in your account, please contact your bank.</p>
          </div>`;
      } else {
        refundIcon = "🔄";
        refundStatusBadge = `<span style="background-color: #e2e3e5; color: #383d41; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">PROCESSING</span>`;
        refundMessage = `
          <div style="background-color: #e2e3e5; border: 1px solid #d6d8db; color: #383d41; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <strong>🔄 Refund Being Processed</strong>
            <p style="margin: 10px 0 0 0;">Your refund is being processed and will be completed within 5-7 working days.</p>
          </div>`;
      }
    } else if (refundError) {
      refundIcon = "⚠️";
      refundStatusBadge = `<span style="background-color: #f8d7da; color: #721c24; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">MANUAL PROCESSING</span>`;
      refundMessage = `
        <div style="background-color: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <strong>⚠️ Refund Requires Manual Processing</strong>
          <p style="margin: 10px 0;">We encountered a technical issue while processing your refund automatically. Don't worry - your refund is guaranteed!</p>
          
          <div style="background-color: #fff; padding: 15px; border-radius: 5px; margin: 10px 0;">
            <h4 style="margin-top: 0; color: #721c24;">📋 Next Steps:</h4>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>Our support team has been notified and will process your refund manually</li>
              <li>You'll receive your refund within 2-3 business days</li>
              <li>If you don't see the refund by then, please contact us with your order ID</li>
            </ul>
          </div>
          
          <p style="margin: 10px 0 0 0;">We apologize for any inconvenience this may cause.</p>
        </div>`;
    } else {
      refundIcon = "ℹ️";
      refundStatusBadge = `<span style="background-color: #d1ecf1; color: #0c5460; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">NO PAYMENT</span>`;
      refundMessage = `
        <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; color: #0c5460; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <strong>ℹ️ No Refund Required</strong>
          <p style="margin: 10px 0 0 0;">Since no payment was made for this order, no refund is required. Your order has been cancelled successfully.</p>
        </div>`;
    }

  return { refundIcon, refundStatusBadge, refundMessage };
};

export const orderCancelledEmail = ({ order, refundProcessed, refundData, refundError }) => {
  const { refundIcon, refundStatusBadge, refundMessage } = refundNotice({
    refundProcessed,
    refundData,
    refundError,
  });

  return `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="text-align: center; border-bottom: 2px solid #dc3545; padding-bottom: 20px; margin-bottom: 30px;">
      <h1 style="color: #dc3545; margin: 0;">❌ Order Cancelled</h1>
      <p style="color: #666; margin: 5px 0;">Your order has been successfully cancelled</p>
    </div>

    <!-- Greeting -->
    <p style="font-size: 16px;">Dear ${order.name || "Valued Customer"},</p>
    <p>Your order cancellation request has been processed successfully. We're sorry to see you go, but we understand that plans can change.</p>

    <!-- Order Details Card -->
    <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; border-left: 4px solid #dc3545;">
      <h3 style="margin-top: 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Cancelled Order Details</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Order ID:</td>
          <td style="padding: 10px 0; color: #dc3545; font-weight: bold;">#${
            order.id
          }</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Order Status:</td>
          <td style="padding: 10px 0;">
            <span style="background-color: #dc3545; color: white; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">
              CANCELLED
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Original Total:</td>
          <td style="padding: 10px 0; font-size: 16px; color: #333; font-weight: bold;">
            ₦${order.total.toLocaleString()}
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Cancellation Date:</td>
          <td style="padding: 10px 0;">${new Date().toLocaleDateString(
            "en-US",
            {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }
          )}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Refund Status:</td>
          <td style="padding: 10px 0;">${refundStatusBadge}</td>
        </tr>
      </table>
    </div>

    <!-- Refund Information -->
    <div style="margin: 25px 0;">
      <h3 style="color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">
        ${refundIcon} Refund Information
      </h3>
      ${refundMessage}
    </div>

    <!-- What Happens Next -->
    <div style="background-color: #e8f4f8; padding: 20px; border-radius: 8px; margin: 25px 0;">
      <h3 style="margin-top: 0; color: #2c5aa0;">📋 What Happens Next?</h3>
      <ul style="padding-left: 20px; line-height: 1.6; color: #2c5aa0;">
        <li>Your order has been completely removed from our system</li>
        <li>All reserved inventory has been released back to stock</li>
        <li>You will not be charged for this order</li>
        ${
          refundProcessed
            ? "<li>Your refund is being processed as detailed above</li>"
            : ""
        }
        <li>You're free to place a new order anytime</li>
      </ul>
    </div>

    <!-- Support Section -->
    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0;">
      <h4 style="margin-top: 0; color: #333;">Need Help? 🤝</h4>
      <p style="margin-bottom: 10px;">If you have any questions about this cancellation or need assistance:</p>
      <ul style="list-style: none; padding-left: 0;">
        <li style="margin: 8px 0;">📧 <strong>Email:</strong> ${
          process.env.EMAIL_USER
        }</li>
        <li style="margin: 8px 0;">📞 <strong>Phone:</strong> ${process.env.SUPPORT_PHONE || '+234-XXX-XXXX-XXX'}</li>
        <li style="margin: 8px 0;">💬 <strong>Live Chat:</strong> Available on our website</li>
      </ul>
      <p style="font-size: 14px; color: #666; margin-bottom: 0;">
        Please reference Order ID <strong>#${
          order.id
        }</strong> when contacting support.
      </p>
    </div>

    <!-- Come Back Section -->
    <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #fff3cd; border-radius: 8px;">
      <h4 style="margin-top: 0;">We'd Love to Have You Back! 💝</h4>
      <p style="margin-bottom: 15px;">We're constantly adding new products and improving our service.</p>
      <a href="${process.env.BASE_URL || "#"}" 
        style="display: inline-block; background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
        🛍️ Continue Shopping
      </a>
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding-top: 30px; border-top: 1px solid #ddd; margin-top: 40px;">
      <p style="font-size: 16px; margin-bottom: 10px;">Thank you for giving us a try! 🙏</p>
      <p style="color: #666; margin-bottom: 20px;">
        We hope to serve you better in the future.<br>
        <strong>The E-Commerce API Team</strong>
      </p>
      
      <!-- Email Footer -->
      <div style="font-size: 12px; color: #999; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
        <p>This email was sent to <strong>${order.email}</strong></p>
        <p>© 2024 E-Commerce API. All rights reserved.</p>
        <p>If you have any concerns about this cancellation, please contact us immediately.</p>
      </div>
    </div>
  </div>
`;
};
