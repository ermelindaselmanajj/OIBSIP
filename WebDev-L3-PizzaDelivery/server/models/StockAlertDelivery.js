const mongoose = require("mongoose");

const stockAlertDeliverySchema = new mongoose.Schema({
  ingredient: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Inventory" },
  episode: { type: String, required: true },
  recipient: { type: String, required: true },
  sentAt: { type: Date, required: true },
}, { autoCreate: false, autoIndex: false });

stockAlertDeliverySchema.index({ ingredient: 1, episode: 1, recipient: 1 }, { unique: true });

module.exports = mongoose.model("StockAlertDelivery", stockAlertDeliverySchema);
