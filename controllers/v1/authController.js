import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import db from "../../config/db.js";
import createTransporter from "../../utils/email.js";
import { passwordResetEmail } from "../../emails/authEmails.js";

// Reset links are stored hashed, so reading the database doesn't give anyone a usable link
const hashResetToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const register = async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    const existingUser = await db.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "User already exists, try logging in",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await db.query(
      "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, role, created_at, updated_at",
      [name, email, hashedPassword]
    );

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: newUser.rows[0],
    });
  } catch (err) {
    console.log("Error registering user:", err);
    res.status(500).json({
      success: false,
      message: "Failed to register user",
    });
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found, try registering",
      });
    } else {
      const user = result.rows[0];
      const passwordMatch = await bcrypt.compare(password, user.password);

      if (passwordMatch) {
        const token = jwt.sign(
          { id: user.id, role: user.role, email: user.email },
          process.env.JWT_SECRET,
          { expiresIn: "1d" }
        );
        res.status(200).json({
          success: true,
          message: "Login successful",
          token: token,
        });
      } else {
        res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
      }
    }
  } catch (err) {
    console.log("Error logging in:", err);
    res.status(500).json({
      success: false,
      message: "Failed to log in",
    });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // Check if user exists
    const user = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    if (user.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User with this email does not exist",
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + (15 * 60 * 1000)); // 15 minutes in milliseconds

    // Save token and expiry to database
    await db.query(
      "UPDATE users SET reset_password_token = $1, reset_token_expiry = $2 WHERE email = $3",
      [hashResetToken(resetToken), resetTokenExpiry, email]
    );

    // Create transporter
    const transporter = createTransporter();

    // Create reset URL
    const resetUrl = `${process.env.BASE_URL}/v1/auth/reset-password/${resetToken}`;

    // Email options
    const mailOptions = {
      from: `E-commerce API <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Password Reset Request",
      html: passwordResetEmail({ resetUrl })
    };

    // Send email
    await transporter.sendMail(mailOptions);

    res.status(200).json({
      success: true,
      message: "Password reset email sent successfully"
    });
  } catch (err) {
    console.error("Error in forgotPassword:", err);
    res.status(500).json({
      success: false,
      message: "Failed to process forgot password request",
    }); 
  }
}

// The emailed link opens in a browser, and there is no frontend yet to host this form
export const showResetPasswordForm = (req, res) => {
  // The token is in the URL, so don't send it to other sites
  res.set("Referrer-Policy", "no-referrer");
  res.type("html").send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Reset Password</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 400px; margin: 40px auto; padding: 0 16px;">
        <h2 style="color: #333;">Reset your password</h2>
        <form method="post">
          <p><label>New password<br><input type="password" name="password" minlength="6" required></label></p>
          <p><label>Confirm password<br><input type="password" name="confirmPassword" minlength="6" required></label></p>
          <button type="submit">Reset Password</button>
        </form>
      </body>
    </html>
  `);
};

export const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;

    // Validate input
    if (!password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Both password fields are required",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    // Find user by token and check expiry
    const user = await db.query(
      "SELECT * FROM users WHERE reset_password_token = $1 AND reset_token_expiry > NOW()",
      [hashResetToken(token)]
    );

    if (user.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user password and clear reset token
    await db.query(
      "UPDATE users SET password = $1, reset_password_token = NULL, reset_token_expiry = NULL, updated_at = NOW() WHERE id = $2",
      [hashedPassword, user.rows[0].id]
    );

    res.status(200).json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (err) {
    console.error("Error in resetPassword:", err);
    res.status(500).json({
      success: false,
      message: "Failed to reset password",
    });
  }
}