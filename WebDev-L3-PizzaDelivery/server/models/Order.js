const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    base: {
      type: String,
      required: true,
    },

    sauce: {
      type: String,
      required: true,
    },

    cheese: {
      type: String,
      required: true,
    },

    vegetables: [
      {
        type: String,
      },
    ],

    totalPrice: {
      type: Number,
      required: true,
    },

    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid"],
      default: "Pending",
    },

    orderStatus: {
      type: String,
      enum: ["Order Received", "In Kitchen", "Sent to Delivery"],
      default: "Order Received",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Order", orderSchema);