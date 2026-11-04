// Sent when the Paystack webhook confirms a payment
export const paymentReceivedEmail = ({ customer, order, amount }) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="text-align: center; border-bottom: 2px solid #28a745; padding-bottom: 20px; margin-bottom: 30px;">
      <h1 style="color: #333; margin: 0;">✅ Payment Confirmed!</h1>
      <p style="color: #666; margin: 5px 0;">Your order is now being processed</p>
    </div>

    <!-- Greeting -->
    <p style="font-size: 16px;">Hi ${customer.name || "Valued Customer"},</p>
    <p>Great news! Your payment for order <strong>#${
      order.id
    }</strong> has been successfully confirmed. Your order is now being processed and will be prepared for shipment.</p>
    
    <!-- Success Banner -->
    <div style="background-color: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
      <strong>🎉 Payment Successfully Processed</strong>
    </div>

    <!-- Order Details Card -->
    <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; border-left: 4px solid #28a745;">
      <h3 style="margin-top: 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Payment & Order Details</h3>
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
              ${order.order_status.toUpperCase()}
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Payment Reference:</td>
          <td style="padding: 10px 0; font-family: monospace; background-color: #e9ecef; padding: 5px 8px; border-radius: 4px;">${
            order.payment_ref
          }</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Payment Method:</td>
          <td style="padding: 10px 0; text-transform: capitalize;">${
            order.payment_method
          }</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Amount Paid:</td>
          <td style="padding: 10px 0; font-size: 18px; color: #28a745; font-weight: bold;">
            ₦${(amount / 100).toLocaleString()}
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Payment Date:</td>
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
      </table>
    </div>

    <!-- Next Steps -->
    <div style="background-color: #e8f4f8; padding: 20px; border-radius: 8px; margin: 25px 0;">
      <h3 style="margin-top: 0; color: #2c5aa0;">📦 What Happens Next?</h3>
      <ol style="padding-left: 20px; line-height: 1.6;">
        <li><strong>Order Processing</strong> - We're preparing your items for shipment</li>
        <li><strong>Quality Check</strong> - Each item is carefully inspected</li>
        <li><strong>Packaging</strong> - Your order will be securely packaged</li>
        <li><strong>Shipping</strong> - You'll receive tracking information via email</li>
        <li><strong>Delivery</strong> - Your order will arrive at your specified address</li>
      </ol>
      <p style="margin-bottom: 0; font-size: 14px; color: #666;">
        <strong>Estimated processing time:</strong> 1-2 business days
      </p>
    </div>

    <!-- Track Order Section -->
    <div style="text-align: center; margin: 30px 0;">
      <p>Want to track your order?</p>
      <a href="${process.env.BASE_URL}/v1/order/${order.id}/history" 
        style="display: inline-block; background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
        Track Your Order
      </a>
    </div>

    <!-- Support Section -->
    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0;">
      <h4 style="margin-top: 0; color: #333;">Need Help? 🤝</h4>
      <p style="margin-bottom: 10px;">Our customer support team is here to help:</p>
      <ul style="list-style: none; padding-left: 0;">
        <li style="margin: 8px 0;">📧 <strong>Email:</strong> ${process.env.EMAIL_USER}</li>
        <li style="margin: 8px 0;">📞 <strong>Phone:</strong> ${process.env.SUPPORT_PHONE || '+234-XXX-XXXX-XXX'}</li>
        <li style="margin: 8px 0;">💬 <strong>Live Chat:</strong> Available on our website</li>
      </ul>
      <p style="font-size: 14px; color: #666; margin-bottom: 0;">
        Please reference Order ID <strong>#${
          order.id
        }</strong> when contacting support.
      </p>
    </div>

    <!-- Social Media & Reviews -->
    <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #fff3cd; border-radius: 8px;">
      <h4 style="margin-top: 0;">Love your purchase? 💝</h4>
      <p style="margin-bottom: 15px;">Share your experience and help others discover great products!</p>
      <div style="margin: 15px 0;">
        <a href="#" style="text-decoration: none; margin: 0 10px; font-size: 24px;">📘</a>
        <a href="#" style="text-decoration: none; margin: 0 10px; font-size: 24px;">📷</a>
        <a href="#" style="text-decoration: none; margin: 0 10px; font-size: 24px;">🐦</a>
      </div>
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
        <p>This email was sent to <strong>${customer.email}</strong></p>
        <p>© 2024 E-commerce API. All rights reserved.</p>
        <p>If you have any concerns about this transaction, please contact us immediately.</p>
      </div>
    </div>
  </div>
`;

// Sent when the customer's own verification confirms a payment
export const paymentConfirmedEmail = ({ user, updatedOrder, reference, paymentMethod }) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="text-align: center; border-bottom: 2px solid #28a745; padding-bottom: 20px; margin-bottom: 30px;">
      <h1 style="color: #333; margin: 0;">✅ Payment Confirmed!</h1>
      <p style="color: #666; margin: 5px 0;">Your order is now being processed</p>
    </div>

    <!-- Greeting -->
    <p style="font-size: 16px;">Hi ${
      user.name || "Valued Customer"
    },</p>
    <p>Great news! Your payment for order <strong>#${
      updatedOrder.id
    }</strong> has been successfully confirmed. Your order is now being processed and will be prepared for shipment.</p>
    
    <!-- Success Banner -->
    <div style="background-color: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
      <strong>🎉 Payment Successfully Processed</strong>
    </div>

    <!-- Order Details Card -->
    <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; border-left: 4px solid #28a745;">
      <h3 style="margin-top: 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Payment & Order Details</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Order ID:</td>
          <td style="padding: 10px 0; color: #007bff; font-weight: bold;">#${
            updatedOrder.id
          }</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Order Status:</td>
          <td style="padding: 10px 0;">
            <span style="background-color: #ffc107; color: #000; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">
              ${updatedOrder.order_status.toUpperCase()}
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Payment Reference:</td>
          <td style="padding: 10px 0; font-family: monospace; background-color: #e9ecef; padding: 5px 8px; border-radius: 4px;">${reference}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Payment Method:</td>
          <td style="padding: 10px 0; text-transform: capitalize;">${paymentMethod}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Amount Paid:</td>
          <td style="padding: 10px 0; font-size: 18px; color: #28a745; font-weight: bold;">
            ₦${updatedOrder.total.toLocaleString()}
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Payment Date:</td>
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
      </table>
    </div>

    <!-- Next Steps -->
    <div style="background-color: #e8f4f8; padding: 20px; border-radius: 8px; margin: 25px 0;">
      <h3 style="margin-top: 0; color: #2c5aa0;">📦 What Happens Next?</h3>
      <ol style="padding-left: 20px; line-height: 1.6;">
        <li><strong>Order Processing</strong> - We're preparing your items for shipment</li>
        <li><strong>Quality Check</strong> - Each item is carefully inspected</li>
        <li><strong>Packaging</strong> - Your order will be securely packaged</li>
        <li><strong>Shipping</strong> - You'll receive tracking information via email</li>
        <li><strong>Delivery</strong> - Your order will arrive at your specified address</li>
      </ol>
      <p style="margin-bottom: 0; font-size: 14px; color: #666;">
        <strong>Estimated processing time:</strong> 1-2 business days
      </p>
    </div>

    <!-- Track Order Section -->
    <div style="text-align: center; margin: 30px 0;">
      <p>Want to track your order?</p>
      <a href="${process.env.BASE_URL}/v1/order/${updatedOrder.id}/history" 
        style="display: inline-block; background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
        Track Your Order
      </a>
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
          updatedOrder.id
        }</strong> when contacting support.
      </p>
    </div>

    <!-- Social Media & Reviews -->
    <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #fff3cd; border-radius: 8px;">
      <h4 style="margin-top: 0;">Love your purchase? 💝</h4>
      <p style="margin-bottom: 15px;">Share your experience and help others discover great products!</p>
      <div style="margin: 15px 0;">
        <a href="#" style="text-decoration: none; margin: 0 10px; font-size: 24px;">📘</a>
        <a href="#" style="text-decoration: none; margin: 0 10px; font-size: 24px;">📷</a>
        <a href="#" style="text-decoration: none; margin: 0 10px; font-size: 24px;">🐦</a>
      </div>
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
        <p>This email was sent to <strong>${user.email}</strong></p>
        <p>© 2024 E-commerce API. All rights reserved.</p>
        <p>If you have any concerns about this transaction, please contact us immediately.</p>
      </div>
    </div>
  </div>
`;

// Sent when an admin verifies a payment manually
export const paymentVerifiedByAdminEmail = ({ customer, updatedOrder, reference, paymentMethod }) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="text-align: center; border-bottom: 2px solid #28a745; padding-bottom: 20px; margin-bottom: 30px;">
      <h1 style="color: #333; margin: 0;">✅ Payment Confirmed!</h1>
      <p style="color: #666; margin: 5px 0;">Your order is now being processed</p>
    </div>

    <!-- Greeting -->
    <p style="font-size: 16px;">Hi ${
      customer.name || "Valued Customer"
    },</p>
    <p>Great news! Your payment for order <strong>#${
      updatedOrder.id
    }</strong> has been manually verified by our team. Your order is now being processed and will be prepared for shipment.</p>
    
    <!-- Success Banner -->
    <div style="background-color: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
      <strong>🎉 Payment Successfully Verified by Admin</strong>
    </div>

    <!-- Order Details Card -->
    <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; border-left: 4px solid #28a745;">
      <h3 style="margin-top: 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Payment & Order Details</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Order ID:</td>
          <td style="padding: 10px 0; color: #007bff; font-weight: bold;">#${
            updatedOrder.id
          }</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Order Status:</td>
          <td style="padding: 10px 0;">
            <span style="background-color: #ffc107; color: #000; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">
              PROCESSING
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Payment Reference:</td>
          <td style="padding: 10px 0; font-family: monospace; background-color: #e9ecef; padding: 5px 8px; border-radius: 4px;">${reference}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Payment Method:</td>
          <td style="padding: 10px 0; text-transform: capitalize;">${paymentMethod}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Amount Paid:</td>
          <td style="padding: 10px 0; font-size: 18px; color: #28a745; font-weight: bold;">
            ₦${updatedOrder.total.toLocaleString()}
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Verified By:</td>
          <td style="padding: 10px 0; color: #dc3545; font-weight: bold;">Admin Team</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: bold; color: #555;">Verification Date:</td>
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
      </table>
    </div>

    <!-- Next Steps -->
    <div style="background-color: #e8f4f8; padding: 20px; border-radius: 8px; margin: 25px 0;">
      <h3 style="margin-top: 0; color: #2c5aa0;">📦 What Happens Next?</h3>
      <ol style="padding-left: 20px; line-height: 1.6;">
        <li><strong>Order Processing</strong> - We're preparing your items for shipment</li>
        <li><strong>Quality Check</strong> - Each item is carefully inspected</li>
        <li><strong>Packaging</strong> - Your order will be securely packaged</li>
        <li><strong>Shipping</strong> - You'll receive tracking information via email</li>
        <li><strong>Delivery</strong> - Your order will arrive at your specified address</li>
      </ol>
      <p style="margin-bottom: 0; font-size: 14px; color: #666;">
        <strong>Estimated processing time:</strong> 1-2 business days
      </p>
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
          updatedOrder.id
        }</strong> when contacting support.
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
        <p>This email was sent to <strong>${customer.email}</strong></p>
        <p>© 2024 E-commerce API. All rights reserved.</p>
        <p>If you have any concerns about this transaction, please contact us immediately.</p>
      </div>
    </div>
  </div>
`;

export const refundProcessedEmail = ({ customer, order, refund_id, amount }) => `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <!-- Header -->
  <div style="text-align: center; border-bottom: 2px solid #28a745; padding-bottom: 20px; margin-bottom: 30px;">
    <h1 style="color: #28a745; margin: 0;">✅ Refund Processed!</h1>
    <p style="color: #666; margin: 5px 0;">Your refund has been successfully processed</p>
  </div>

  <!-- Greeting -->
  <p style="font-size: 16px;">Hi ${customer?.name || "Valued Customer"},</p>
  <p>Great news! Your refund for order <strong>#${order.id}</strong> has been successfully processed and is on its way back to your account.</p>
  
  <!-- Success Banner -->
  <div style="background-color: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
    <strong>💰 Refund Successfully Processed</strong>
  </div>

  <!-- Refund Details Card -->
  <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; border-left: 4px solid #28a745;">
    <h3 style="margin-top: 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Refund Details</h3>
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 10px 0; font-weight: bold; color: #555;">Order ID:</td>
        <td style="padding: 10px 0; color: #007bff; font-weight: bold;">#${order.id}</td>
      </tr>
      <tr>
        <td style="padding: 10px 0; font-weight: bold; color: #555;">Original Payment Reference:</td>
        <td style="padding: 10px 0; font-family: monospace; background-color: #e9ecef; padding: 5px 8px; border-radius: 4px;">${order.payment_ref}</td>
      </tr>
      <tr>
        <td style="padding: 10px 0; font-weight: bold; color: #555;">Refund ID:</td>
        <td style="padding: 10px 0; font-family: monospace; background-color: #e9ecef; padding: 5px 8px; border-radius: 4px;">${refund_id}</td>
      </tr>
      <tr>
        <td style="padding: 10px 0; font-weight: bold; color: #555;">Refund Amount:</td>
        <td style="padding: 10px 0; font-size: 18px; color: #28a745; font-weight: bold;">
          ₦${(amount / 100).toLocaleString()}
        </td>
      </tr>
      <tr>
        <td style="padding: 10px 0; font-weight: bold; color: #555;">Processing Date:</td>
        <td style="padding: 10px 0;">${new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long", 
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}</td>
      </tr>
    </table>
  </div>

  <!-- Timeline Section -->
  <div style="background-color: #e8f4f8; padding: 20px; border-radius: 8px; margin: 25px 0;">
    <h3 style="margin-top: 0; color: #2c5aa0;">⏰ When Will You Receive Your Refund?</h3>
    <div style="line-height: 1.8;">
      <p style="margin: 10px 0;"><strong>💳 Card Payments:</strong> 3-5 business days</p>
      <p style="margin: 10px 0;"><strong>🏦 Bank Transfers:</strong> 1-3 business days</p>
      <p style="margin: 10px 0;"><strong>📱 Mobile Money:</strong> 1-2 business days</p>
    </div>
    <p style="font-size: 14px; color: #666; margin-bottom: 0;">
      <strong>Note:</strong> Processing times may vary depending on your bank or payment provider.
    </p>
  </div>

  <!-- Important Information -->
  <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 8px; margin: 25px 0;">
    <h4 style="margin-top: 0; color: #856404;">📋 Important Information</h4>
    <ul style="margin: 10px 0; padding-left: 20px; color: #856404;">
      <li>The refund will be credited to the same payment method used for the original purchase</li>
      <li>You'll see the transaction appear as "Refund - Order #${order.id}" in your statement</li>
      <li>If you don't see the refund after the expected timeframe, please contact your bank first</li>
    </ul>
  </div>

  <!-- Support Section -->
  <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0;">
    <h4 style="margin-top: 0; color: #333;">Need Help? 🤝</h4>
    <p style="margin-bottom: 10px;">Our customer support team is here to help:</p>
    <ul style="list-style: none; padding-left: 0;">
      <li style="margin: 8px 0;">📧 <strong>Email:</strong> ${process.env.EMAIL_USER}</li>
      <li style="margin: 8px 0;">📞 <strong>Phone:</strong> ${process.env.SUPPORT_PHONE || '+234-XXX-XXXX-XXX'}</li>
      <li style="margin: 8px 0;">💬 <strong>Live Chat:</strong> Available on our website</li>
    </ul>
    <p style="font-size: 14px; color: #666; margin-bottom: 0;">
      Please reference Order ID <strong>#${order.id}</strong> and Refund ID <strong>${refund_id}</strong> when contacting support.
    </p>
  </div>

  <!-- Footer -->
  <div style="text-align: center; padding-top: 30px; border-top: 1px solid #ddd; margin-top: 40px;">
    <p style="font-size: 18px; margin-bottom: 10px;">Thank you for your understanding! 🙏</p>
    <p style="color: #666; margin-bottom: 20px;">
      We're sorry to see you go, but we're here whenever you're ready to shop again.<br>
      <strong>The E-commerce API Team</strong>
    </p>
    
    <!-- Email Footer -->
    <div style="font-size: 12px; color: #999; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
      <p>This email was sent to <strong>${customer.email}</strong></p>
      <p>© 2024 E-commerce API. All rights reserved.</p>
      <p>If you have any concerns about this refund, please contact us immediately.</p>
    </div>
  </div>
</div>
`;
