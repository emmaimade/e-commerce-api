export const passwordResetEmail = ({ resetUrl }) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <h2 style="color: #333;">Password Reset Request</h2>
    <p>You requested a password reset for your account.</p>
    <p>Click the button below to reset your password:</p>
    <a href="${resetUrl}" 
       style="background-color: #007bff; color: white; padding: 10px 20px; 
              text-decoration: none; border-radius: 5px; display: inline-block;">
      Reset Password
    </a>
    <p>Or copy and paste this link into your browser:</p>
    <p>${resetUrl}</p>
    <p>This link will expire in 15 minutes.</p>
    <p>If you didn't request this, please ignore this email.</p>
  </div>
`;
