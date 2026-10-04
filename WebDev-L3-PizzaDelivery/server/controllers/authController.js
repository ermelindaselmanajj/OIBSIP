const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const sendEmail = require("../utils/sendEmail");
const { clientUrl, serverUrl } = require("../config/urls");

const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Please fill in all fields",
      });
    }

    let user = await User.findOne({ email });

    if (user) {
      if (user.isVerified || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ message: "User already exists" });
      }
      // A delivery retry must never overwrite the existing account's identity.
      if (!user.verificationToken) {
        user.verificationToken = crypto.randomBytes(32).toString("hex");
        await user.save();
      }
    } else {
      user = await User.create({
        name,
        email,
        password: await bcrypt.hash(password, 10),
        verificationToken: crypto.randomBytes(32).toString("hex"),
        isVerified: false,
      });
    }

    const verificationUrl = `${serverUrl()}/api/auth/verify-email/${user.verificationToken}`;
    try {
      await sendEmail({
        to: user.email,
        subject: "Verify your Pizza Delivery account",
        html: `
          <h2>Welcome to Pizza Delivery</h2>
          <p>Please verify your email by clicking the link below:</p>
          <a href="${verificationUrl}">Verify Email</a>
        `,
      });
    } catch (error) {
      console.error("Verification email error:", error);
      return res.status(503).json({
        message: "Verification email could not be sent. Retry registration with the same email and password.",
      });
    }

    return res.status(201).json({
      message: "Registration successful. Verification email accepted for delivery. Please check your inbox.",
    });
  } catch (error) {
    console.error("Registration error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

const verifyEmail = async (req, res) => {
  try {
    const user = await User.findOne({
      verificationToken: req.params.token,
    });

    if (!user) {
      return res.status(400).json({
        message: "Invalid verification token",
      });
    }

    user.isVerified = true;
    user.verificationToken = undefined;

    await user.save();

    return res.redirect(
      `${clientUrl()}/login?verified=true`
    );
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Please enter email and password",
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    if (!user.isVerified) {
      return res.status(401).json({
        message: "Please verify your email before logging in",
      });
    }

    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d",
      }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");

    const resetUrl = `${clientUrl()}/reset-password/${resetToken}`;

    // Keep the existing reset link valid if SMTP fails. Do not roll back a
    // shared DB record: a concurrent request may have saved a newer token.
    try {
      await sendEmail({
        to: user.email,
        subject: "Reset your Pizza Delivery password",
        html: `
          <h2>Password Reset</h2>
          <p>Click the link below to reset your password:</p>
          <a href="${resetUrl}">Reset Password</a>
          <p>This link expires in 15 minutes.</p>
        `,
      });
    } catch (error) {
      console.error("Password reset email error:", error);
      return res.status(503).json({ message: "Password reset email could not be sent. Please try again." });
    }

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
    await user.save();

    return res.json({ message: "Password reset email accepted for delivery. Please check your inbox." });
  } catch (error) {
    console.error("Forgot password error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        message: "Please enter a new password",
      });
    }

    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        message: "Invalid or expired reset token",
      });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    res.json({
      message: "Password reset successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  verifyEmail,
  forgotPassword,
  resetPassword,
};