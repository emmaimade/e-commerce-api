// Small pages for browser redirects, until there is a frontend to host them

const page = (title, body) => `
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${title}</title>
    </head>
    <body style="font-family: Arial, sans-serif; max-width: 400px; margin: 40px auto; padding: 0 16px;">
      ${body}
    </body>
  </html>
`;

export const resetPasswordPage = () =>
  page(
    "Reset Password",
    `<h2 style="color: #333;">Reset your password</h2>
    <form method="post">
      <p><label>New password<br><input type="password" name="password" minlength="6" required></label></p>
      <p><label>Confirm password<br><input type="password" name="confirmPassword" minlength="6" required></label></p>
      <button type="submit">Reset Password</button>
    </form>`
  );

export const paymentStatusPage = ({ paid }) => {
  const heading = paid ? "Payment confirmed" : "Your payment is being confirmed";
  const message = paid
    ? "Thank you! Your order is now being processed."
    : "We'll email you as soon as your payment is confirmed. You can safely close this page.";

  return page(
    heading,
    `<div style="text-align: center;">
      <h2 style="color: #333;">${heading}</h2>
      <p style="color: #666;">${message}</p>
    </div>`
  );
};
