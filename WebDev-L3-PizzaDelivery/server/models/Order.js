const mongoose = require("mongoose");
const amount = () => ({ type: Number, min: 0, required: true, validate: { validator: Number.isSafeInteger, message: "Amount must be a nonnegative safe integer" } });
const itemSchema = new mongoose.Schema({
  ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory", required: true },
  name: { type: String, required: true },
  category: { type: String, enum: ["base", "sauce", "cheese", "vegetable"], required: true },
  unitPriceMinor: amount(), quantity: { type: Number, min: 1, max: 10, required: true, validate: Number.isInteger },
  lineTotalMinor: amount(),
}, { _id: false });
const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  status: { type: String, enum: ["pending_payment"] },
  currency: { type: String, enum: ["EUR", "INR"] },
  quantity: { type: Number, min: 1, max: 10, validate: Number.isInteger },
  items: { type: [itemSchema], default: undefined },
  unitTotalMinor: { ...amount(), required: false }, totalMinor: { ...amount(), required: false },
  idempotencyKey: { type: String, match: /^[A-Za-z\d_-]{16,128}$/ },
  selectionHash: { type: String, match: /^[a-f\d]{64}$/ },
  // Legacy fields remain readable without imposing legacy kitchen/payment defaults.
  base: String, sauce: String, cheese: String, vegetables: { type: [String], default: undefined },
  totalPrice: Number, paymentStatus: String, orderStatus: String,
}, { timestamps: true });
orderSchema.pre("validate", function () {
  if (this.status === "pending_payment") {
    for (const field of ["currency", "quantity", "items", "unitTotalMinor", "totalMinor", "idempotencyKey", "selectionHash"]) {
      if (this[field] === undefined || this[field] === null || (field === "items" && this.items.length < 3)) this.invalidate(field, "Required for pending orders");
    }
  }
});
orderSchema.index({ user: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } });
module.exports = mongoose.model("Order", orderSchema);
