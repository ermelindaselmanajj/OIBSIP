const mongoose = require("mongoose");

const inventorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      set: value => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value,
    },

    category: {
      type: String,
      enum: ["base", "sauce", "cheese", "vegetable"],
      required: true,
    },

    priceCurrency: { type: String, enum: ["EUR"] },
    priceMinor: {
      type: Number, min: 0,
      validate: { validator: value => value === undefined || (Number.isSafeInteger(value) && value >= 0), message: "Price must be a nonnegative safe integer" },
    },

    stock: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: { validator: Number.isSafeInteger, message: "Stock must be a safe integer" },
    },

    threshold: {
      type: Number,
      default: 20,
      required: true,
      min: 0,
      validate: { validator: Number.isSafeInteger, message: "Threshold must be a safe integer" },
    },

    lowStockAlertEpisode: { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

inventorySchema.index({ category: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Inventory", inventorySchema);
