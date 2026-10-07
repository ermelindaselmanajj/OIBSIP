const mongoose = require("mongoose");

const verificationLinkSchema = new mongoose.Schema({
  hash: { type: String, required: true },
  email: { type: String, required: true },
  expiresAt: { type: Date, required: true },
}, { _id: false });

const adminSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
    },

    password: {
      type: String,
      required: true,
    },

    isVerified: { type: Boolean, default: false },
    emailVerification: { type: verificationLinkSchema, select: false },
    pendingEmailVerification: { type: verificationLinkSchema, select: false },
    verificationEmailSentAt: { type: Date, select: false },
    verificationSendLockUntil: { type: Date, select: false },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Admin", adminSchema);
