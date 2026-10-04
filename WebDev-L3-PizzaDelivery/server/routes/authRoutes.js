const express = require("express");

const {
  getCurrentUser,
  registerUser,
  loginUser,
  verifyEmail,
  forgotPassword,
  resetPassword,
} = require("../controllers/authController");

const { requireRole } = require("../middleware/auth");
const router = express.Router();

router.get("/me", requireRole("user"), getCurrentUser);

router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/verify-email/:token", verifyEmail);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);

module.exports = router;
