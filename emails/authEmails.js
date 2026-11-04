// Goes to an address nobody has proved they own yet, so nothing from the signup
// form may appear here, or the app could be used to send anyone a crafted message
export const verifyEmailEmail = ({ verifyUrl }) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <h2 style="color: #333;">Verify your email</h2>
    <p>Thanks for signing up.</p>
    <p>Click the button below to verify your email and finish creating your account:</p>
    <a href="${verifyUrl}"
       style="background-color: #007bff; color: white; padding: 10px 20px;
              text-decoration: none; border-radius: 5px; display: inline-block;">
      Verify Email
    </a>
    <p>Or copy and paste this link into your browser:</p>
    <p>${verifyUrl}</p>
    <p>This link will expire in 24 hours.</p>
    <p>If you didn't create an account, please ignore this email.</p>
  </div>
`;

export const accountExistsEmail = () => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <h2 style="color: #333;">You already have an account</h2>
    <p>Someone tried to create an account with this email address, but one already exists.</p>
    <p>If this was you, log in with your existing password, or use "forgot password" if you've lost it.</p>
    <p>If it wasn't you, you can safely ignore this email. Nothing on your account has changed.</p>
  </div>
`;

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
