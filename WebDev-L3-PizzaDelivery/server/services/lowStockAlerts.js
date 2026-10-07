const { randomUUID } = require("node:crypto");
const Inventory = require("../models/Inventory");
const Admin = require("../models/Admin");
const StockAlertDelivery = require("../models/StockAlertDelivery");
const sendEmail = require("../utils/sendEmail");
const { clientUrl } = require("../config/urls");

const categoryNames = { base: "Pizza base", sauce: "Sauce", cheese: "Cheese", vegetable: "Vegetable" };
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const normalizeEmail = value => typeof value === "string" ? value.trim().toLowerCase() : "";

function alertMessage(items, inventoryUrl) {
  const text = [
    "Ingredients need restocking",
    ...items.map(item => `${item.name} (${categoryNames[item.category] || item.category}): stock ${item.stock}, threshold ${item.threshold}`),
    `Review inventory: ${inventoryUrl}`,
  ].join("\n");
  const rows = items.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(categoryNames[item.category] || item.category)}</td><td>${item.stock}</td><td>${item.threshold}</td></tr>`).join("");
  return {
    subject: "Pizza Delivery: ingredients need restocking",
    text,
    html: `<h2>Ingredients need restocking</h2><p>These ingredients are at or below their low-stock thresholds.</p><table cellpadding="8"><thead><tr><th>Ingredient</th><th>Category</th><th>Stock</th><th>Threshold</th></tr></thead><tbody>${rows}</tbody></table><p><a href="${escapeHtml(inventoryUrl)}">Review inventory</a></p>`,
  };
}

function createLowStockChecker({
  inventory = Inventory, admins = Admin, deliveries = StockAlertDelivery,
  mail = sendEmail, inventoryUrl = () => `${clientUrl()}/admin/dashboard`,
  now = () => new Date(), logger = console,
} = {}) {
  let running = false;
  let indexesReady = false;

  return async function checkLowStock() {
    if (running) return { skipped: true };
    running = true;
    try {
      const accounts = await admins.find({ isVerified: true }).select("email isVerified").lean();
      const recipients = [...new Set(accounts.filter(admin => admin.isVerified === true)
        .map(admin => normalizeEmail(admin.email)).filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
      if (!recipients.length) return { sent: 0, failed: 0, recipients: 0 };
      if (!indexesReady) {
        await deliveries.createIndexes();
        indexesReady = true;
      }

      await inventory.updateMany({ $expr: { $gt: ["$stock", "$threshold"] }, lowStockAlertEpisode: { $ne: null } },
        { $set: { lowStockAlertEpisode: null } }, { timestamps: false });
      const low = await inventory.find({ $expr: { $lte: ["$stock", "$threshold"] } }).sort({ category: 1, name: 1 }).lean();
      const items = [];
      for (const item of low) {
        const current = await inventory.findOneAndUpdate({ _id: item._id, stock: item.stock, threshold: item.threshold },
          [{ $set: { lowStockAlertEpisode: { $ifNull: ["$lowStockAlertEpisode", randomUUID()] } } }],
          { returnDocument: "after", updatePipeline: true, timestamps: false }).lean();
        if (current) items.push(current);
      }
      if (!items.length) return { sent: 0, failed: 0, recipients: recipients.length };

      let sent = 0, failed = 0;
      for (const recipient of recipients) {
        const accepted = await deliveries.find({ recipient, $or: items.map(item => ({ ingredient: item._id, episode: item.lowStockAlertEpisode })) });
        const notified = new Set(accepted.map(delivery => `${delivery.ingredient}:${delivery.episode}`));
        const pending = items.filter(item => !notified.has(`${item._id}:${item.lowStockAlertEpisode}`));
        if (!pending.length) continue;
        // Recheck stock and the episode immediately before sending: an admin may
        // have restocked while the scheduler was building the digest.
        const eligible = await inventory.find({ $expr: { $lte: ["$stock", "$threshold"] }, $or: pending.map(item => ({ _id: item._id, lowStockAlertEpisode: item.lowStockAlertEpisode })) }).sort({ category: 1, name: 1 }).lean();
        if (!eligible.length) continue;
        try {
          const result = await mail({ to: recipient, ...alertMessage(eligible, inventoryUrl()) });
          if (!Array.isArray(result?.accepted) || !result.accepted.some(address => normalizeEmail(address) === recipient)) {
            throw new Error("SMTP did not accept the recipient");
          }
          const sentAt = now();
          for (const item of eligible) {
            await deliveries.updateOne({ ingredient: item._id, episode: item.lowStockAlertEpisode, recipient },
              { $setOnInsert: { sentAt } }, { upsert: true });
          }
          sent++;
        } catch {
          failed++;
          logger.error("Low-stock email could not be recorded as sent; it remains eligible for retry.");
        }
      }
      return { sent, failed, recipients: recipients.length };
    } finally {
      running = false;
    }
  };
}

module.exports = { createLowStockChecker, alertMessage };
