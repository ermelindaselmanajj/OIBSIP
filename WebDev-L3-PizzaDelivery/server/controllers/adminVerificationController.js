const { randomBytes, createHash } = require("node:crypto");
const Admin = require("../models/Admin");
const sendEmail = require("../utils/sendEmail");
const { clientUrl, serverUrl } = require("../config/urls");

const LINK_LIFETIME_MS = 30 * 60 * 1000;
const SEND_LOCK_MS = 90 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const hashToken = token => createHash("sha256").update(token).digest("hex");
const normalizeEmail = value => typeof value === "string" ? value.trim().toLowerCase() : "";
const clearedVerification = {
  emailVerification: 1, pendingEmailVerification: 1,
  verificationEmailSentAt: 1, verificationSendLockUntil: 1,
};

function createAdminVerificationController({
  admins = Admin, mail = sendEmail, now = () => new Date(),
  urls = { clientUrl, serverUrl }, logger = console,
} = {}) {
  const alreadyVerified = res => res.json({ message: "Your administrator email is already verified.", isVerified: true });

  async function requestEmailVerification(req, res) {
    res.set("Cache-Control", "no-store");
    const body = req.body;
    if (body !== undefined && (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)) {
      return res.status(400).json({ message: "Verification uses the signed-in administrator's email. Do not provide account details." });
    }
    if (req.identity.isVerified === true) return alreadyVerified(res);
    if (!/^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/.test(req.identity.email || "")) {
      return res.status(400).json({ message: "Your account does not have a valid email address. Contact the account administrator." });
    }

    const token = randomBytes(32).toString("hex");
    const hash = hashToken(token);
    const startedAt = now();
    const expiresAt = new Date(startedAt.getTime() + LINK_LIFETIME_MS);
    const owner = { _id: req.identity._id, email: req.identity.email, isVerified: { $ne: true } };
    const pendingOwner = { ...owner, "pendingEmailVerification.hash": hash };
    try {
      const link = `${urls.serverUrl()}/api/admin/verify-email/${token}`;
      const claimed = await admins.findOneAndUpdate({
        ...owner,
        $and: [
          { $or: [{ verificationSendLockUntil: null }, { verificationSendLockUntil: { $lte: startedAt } }] },
          { $or: [{ verificationEmailSentAt: null }, { verificationEmailSentAt: { $lte: new Date(startedAt.getTime() - RESEND_COOLDOWN_MS) } }] },
        ],
      }, { $set: {
        pendingEmailVerification: { hash, email: req.identity.email, expiresAt },
        verificationSendLockUntil: new Date(startedAt.getTime() + SEND_LOCK_MS),
      } }, { returnDocument: "after" });

      if (!claimed) {
        const current = await admins.findById(req.identity._id).select("email isVerified +verificationEmailSentAt +verificationSendLockUntil");
        if (!current || current.email !== req.identity.email) return res.status(401).json({ message: "Your account changed. Please sign in again." });
        if (current.isVerified === true) return alreadyVerified(res);
        const busy = current.verificationSendLockUntil > startedAt;
        const nextAttempt = busy ? current.verificationSendLockUntil.getTime() : (current.verificationEmailSentAt?.getTime() || 0) + RESEND_COOLDOWN_MS;
        const seconds = Math.max(1, Math.ceil((nextAttempt - startedAt.getTime()) / 1000));
        res.set("Retry-After", String(seconds));
        return res.status(busy ? 409 : 429).json({ message: `Please wait ${seconds} seconds before requesting another verification email.` });
      }

      // Keep the previous accepted link intact while SMTP is pending. The new
      // link is already valid if delivery occurs before sendMail resolves.
      try {
        const delivery = await mail({
          to: claimed.email,
          subject: "Verify your Pizza Delivery administrator email",
          text: `Verify your administrator email to receive low-stock alerts:\n${link}\nThis link expires in 30 minutes. If you did not request it, you can ignore this email.`,
          html: `<h2>Verify your administrator email</h2><p>Confirm this email address to receive low-stock alerts.</p><p><a href="${link}">Verify email</a></p><p>This link expires in 30 minutes. If you did not request it, you can ignore this email.</p>`,
        });
        if (!Array.isArray(delivery?.accepted) || !delivery.accepted.some(address => normalizeEmail(address) === normalizeEmail(claimed.email))) {
          throw new Error("SMTP did not accept the recipient");
        }
      } catch {
        try {
          await admins.updateOne(pendingOwner, { $unset: { pendingEmailVerification: 1, verificationSendLockUntil: 1 } });
        } catch { logger.error("Administrator verification retry cleanup failed; the send lock will expire automatically."); }
        return res.status(503).json({ message: "Verification email could not be sent. Please try again. If a request is still in progress, wait 90 seconds." });
      }

      const completed = await admins.updateOne(pendingOwner, {
        $set: { emailVerification: { hash, email: claimed.email, expiresAt }, verificationEmailSentAt: now() },
        $unset: { pendingEmailVerification: 1, verificationSendLockUntil: 1 },
      });
      if (!completed.matchedCount) {
        const current = await admins.findById(req.identity._id);
        if (current?.isVerified === true) return alreadyVerified(res);
        return res.status(409).json({ message: "The verification request changed. Please refresh and try again." });
      }
      return res.status(202).json({ message: "Verification email accepted for delivery. Check your inbox; the link expires in 30 minutes.", isVerified: false });
    } catch {
      logger.error("Administrator verification request could not be completed.");
      return res.status(503).json({ message: "The verification request could not be completed. If an email arrived, its link may still work. Otherwise, try again in 90 seconds." });
    }
  }

  async function verifyAdminEmail(req, res) {
    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "no-referrer");
    try {
      const redirect = `${urls.clientUrl()}/admin/login?verification=`;
      if (typeof req.params.token !== "string" || !/^[a-f\d]{64}$/.test(req.params.token)) return res.redirect(`${redirect}invalid`);
      const hash = hashToken(req.params.token);
      const currentTime = now();
      const conditions = ["emailVerification", "pendingEmailVerification"].map(field => ({
        [`${field}.hash`]: hash,
        [`${field}.expiresAt`]: { $gt: currentTime },
        $expr: { $eq: ["$email", `$${field}.email`] },
      }));
      const verified = await admins.findOneAndUpdate({ isVerified: { $ne: true }, $or: conditions }, {
        $set: { isVerified: true }, $unset: clearedVerification,
      }, { returnDocument: "after" });
      return res.redirect(`${redirect}${verified ? "success" : "invalid"}`);
    } catch {
      return res.status(503).json({ message: "Email verification is temporarily unavailable. Please try opening the link again." });
    }
  }

  return { requestEmailVerification, verifyAdminEmail };
}

module.exports = { createAdminVerificationController, ...createAdminVerificationController(), hashToken, LINK_LIFETIME_MS, SEND_LOCK_MS, RESEND_COOLDOWN_MS };
