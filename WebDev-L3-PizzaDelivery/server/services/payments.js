const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Inventory = require("../models/Inventory");
const { createRazorpay, paymentError } = require("./razorpay");
const { profile, isSupported } = require("./orderTracking");

async function supportsTransactions(connection = mongoose.connection) {
  if (connection.readyState !== 1) return false;
  try {
    const hello = await connection.db.admin().command({ hello: 1 });
    return Boolean((hello.setName || hello.msg === "isdbgrid") && hello.logicalSessionTimeoutMinutes != null && hello.maxWireVersion >= (hello.msg === "isdbgrid" ? 8 : 7));
  } catch { return false; }
}

function createPaymentService({ orders = Order, inventory = Inventory, provider = createRazorpay(),
  startSession = () => mongoose.startSession(), transactionsSupported = supportsTransactions,
  now = () => new Date(),
} = {}) {
  let indexesReady;
  async function config() {
    const result = provider.configuration();
    if (!result.available) return { ...result, mode: "test", currency: "EUR" };
    if (!await transactionsSupported()) return { available: false, mode: "test", currency: "EUR", code: "TRANSACTIONS_REQUIRED", message: "Checkout requires a MongoDB replica set with transaction support." };
    return { ...result, mode: "test", currency: "EUR" };
  }
  async function requireAvailable() {
    const result = await config();
    if (!result.available) throw paymentError(503, result.code, result.message);
    if (!indexesReady) indexesReady = orders.createIndexes().catch(cause => { indexesReady = undefined; throw cause; });
    await indexesReady;
  }
  async function owned(id, user, session) {
    if (typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id)) throw paymentError(400, "INVALID_ORDER", "Invalid order ID.");
    const query = orders.findOne({ _id: id, user });
    const order = await (session ? query.session(session) : query);
    if (!isSupported(order)) throw paymentError(404, "ORDER_NOT_FOUND", "Order not found.");
    return order;
  }
  function snapshot(order) {
    if (order.currency !== "EUR") throw paymentError(409, "CURRENCY_UNSUPPORTED", "Rebuild this order using current EUR prices.");
    const categories = order.items.map(item => item.category);
    if (!Number.isSafeInteger(order.totalMinor) || order.totalMinor <= 0 || !Number.isInteger(order.quantity) || order.quantity < 1 || order.quantity > 10 ||
      new Set(order.items.map(item => String(item.ingredientId))).size !== order.items.length ||
      ["base", "sauce", "cheese"].some(category => categories.filter(value => value === category).length !== 1) ||
      categories.some(category => !["base", "sauce", "cheese", "vegetable"].includes(category)) ||
      order.items.some(item => !/^[a-f\d]{24}$/i.test(String(item.ingredientId)) || item.quantity !== order.quantity || !Number.isSafeInteger(item.unitPriceMinor) || item.unitPriceMinor < 0 || !Number.isSafeInteger(item.lineTotalMinor) || item.lineTotalMinor !== item.unitPriceMinor * item.quantity) ||
      order.items.reduce((sum, item) => sum + item.lineTotalMinor, 0) !== order.totalMinor || order.unitTotalMinor * order.quantity !== order.totalMinor) {
      throw paymentError(409, "INVALID_ORDER_SNAPSHOT", "This order cannot be paid. Rebuild it from current ingredients.");
    }
  }
  function sameAccount(order) {
    if (order.providerKeyId && order.providerKeyId !== provider.publicKey()) throw paymentError(409, "PAYMENT_ACCOUNT_CHANGED", "This payment belongs to a different test-key configuration. Contact the administrator; do not pay again.", { order: profile(order) });
  }
  async function checkStock(order) {
    const items = await inventory.find({ _id: { $in: order.items.map(item => item.ingredientId) } });
    const records = new Map(items.map(item => [String(item._id), item]));
    if (order.items.some(item => !records.has(String(item.ingredientId)) || records.get(String(item.ingredientId)).category !== item.category || !Number.isSafeInteger(records.get(String(item.ingredientId)).stock) || records.get(String(item.ingredientId)).stock < item.quantity)) {
      throw paymentError(409, "INSUFFICIENT_STOCK", "Some ingredients are no longer available in this quantity. Rebuild the order before paying.");
    }
  }
  const checkout = order => ({ order: profile(order), checkout: {
    keyId: provider.publicKey(), providerOrderId: order.providerOrderId, amountMinor: order.totalMinor,
    currency: "EUR", name: "Pizza Delivery", description: `Pizza order ${String(order._id).slice(-8)}`,
  } });
  async function initiate(id, user) {
    let order = await owned(id, user);
    if (order.status === "confirmed" && order.paymentStatus === "paid") return { order: profile(order), checkout: null };
    snapshot(order); await requireAvailable(); sameAccount(order);
    if (order.paymentStatus === "review_required" || order.providerPaymentId) throw paymentError(409, "PAYMENT_REVIEW_REQUIRED", "A captured payment needs confirmation. Check payment status; do not pay again.", { order: profile(order) });
    if (order.providerOrderId) {
      const recovered = await reconcile(id, user);
      if (recovered.order.status === "confirmed") return { order: recovered.order, checkout: null };
      order = await owned(id, user);
      if (order.paymentIssue) throw paymentError(409, order.paymentIssue, "Check the existing payment before starting checkout.", { order: profile(order) });
      await checkStock(order);
      return checkout(order);
    }
    if (order.paymentIssue) {
      if (order.paymentIssue === "PAYMENT_SETUP_IN_PROGRESS" && now() - new Date(order.paymentCreationStartedAt) > 120000) {
        order = await orders.findOneAndUpdate({ _id: id, user, paymentIssue: "PAYMENT_SETUP_IN_PROGRESS", providerOrderId: null }, { $set: { paymentIssue: "PAYMENT_SETUP_REVIEW" } }, { returnDocument: "after" }) || order;
      }
      throw paymentError(409, order.paymentIssue, "Payment setup is pending or uncertain. Contact the administrator before trying another payment.", { order: profile(order) });
    }
    await checkStock(order);
    const token = randomUUID();
    const locked = await orders.findOneAndUpdate({ _id: id, user, status: "pending_payment", providerOrderId: null, providerPaymentId: null, paymentIssue: null }, {
      $set: { paymentCreationToken: token, paymentCreationStartedAt: now(), paymentIssue: "PAYMENT_SETUP_IN_PROGRESS", providerKeyId: provider.publicKey() },
    }, { returnDocument: "after" });
    if (!locked) throw paymentError(409, "PAYMENT_SETUP_IN_PROGRESS", "Another checkout request is already running. Refresh payment status.", { order: profile(await owned(id, user)) });
    try {
      const created = await provider.createOrder({ amount: locked.totalMinor, currency: "EUR", receipt: `pizza_${id}`, notes: { pizzaOrderId: id } });
      if (!/^order_[A-Za-z\d]+$/.test(created?.id || "") || created.amount !== locked.totalMinor || created.currency !== "EUR" || created.receipt !== `pizza_${id}`) throw paymentError(503, "PAYMENT_SETUP_REVIEW", "Razorpay returned an unexpected order. Contact the administrator before paying.");
      const saved = await orders.findOneAndUpdate({ _id: id, user, paymentCreationToken: token, providerOrderId: null }, {
        $set: { providerOrderId: created.id }, $unset: { paymentIssue: 1, paymentCreationToken: 1 },
      }, { returnDocument: "after", runValidators: true });
      if (!saved) throw paymentError(503, "PAYMENT_SETUP_REVIEW", "Payment setup could not be saved safely. Contact the administrator before paying.");
      return checkout(saved);
    } catch (cause) {
      const issue = cause.definitiveRejection ? null : "PAYMENT_SETUP_REVIEW";
      await orders.updateOne({ _id: id, user, paymentCreationToken: token }, { $set: { paymentIssue: issue }, $unset: { paymentCreationToken: 1 } });
      throw paymentError(cause.status || 503, issue || cause.code || "PROVIDER_UNAVAILABLE", issue ? "Payment setup is uncertain. Contact the administrator before retrying; no new payment was started in the app." : cause.message, { order: profile(await owned(id, user)) });
    }
  }
  async function verifyProvider(order, paymentId) {
    const [payment, remoteOrder] = await Promise.all([provider.getPayment(paymentId), provider.getOrder(order.providerOrderId)]);
    if (payment?.id !== paymentId || payment.order_id !== order.providerOrderId || payment.amount !== order.totalMinor || payment.currency !== order.currency ||
      remoteOrder?.id !== order.providerOrderId || remoteOrder.amount !== order.totalMinor || remoteOrder.currency !== order.currency) {
      throw paymentError(409, "PAYMENT_MISMATCH", "The payment does not match this order's amount, currency or provider order.");
    }
    if (payment.status !== "captured" || payment.captured !== true || (payment.amount_refunded || 0) !== 0 || payment.refund_status != null) throw paymentError(409, "PAYMENT_NOT_CAPTURED", "Payment is not captured in full or has been refunded. Check payment status; do not assume confirmation.");
    return payment;
  }
  async function settle(order, payment) {
    if (order.status === "confirmed" && order.paymentStatus === "paid") {
      if (order.providerPaymentId !== payment.id) throw paymentError(409, "PAYMENT_CONFLICT", "This order already has a different confirmed payment.");
      return { order: profile(order) };
    }
    // Persist observed capture before the transaction so a failed database commit
    // can never lead the UI to offer a second charge.
    const observed = await orders.findOneAndUpdate({ _id: order._id, user: order.user, status: "pending_payment", providerOrderId: order.providerOrderId,
      $or: [{ providerPaymentId: null }, { providerPaymentId: payment.id }] }, {
      $set: { providerPaymentId: payment.id, paymentStatus: "review_required", paymentIssue: "PAYMENT_CONFIRMATION_PENDING", capturedPaymentObservedAt: now() },
    }, { returnDocument: "after", runValidators: true });
    if (!observed) {
      const current = await owned(String(order._id), order.user);
      if (current.status === "confirmed" && current.providerPaymentId === payment.id) return { order: profile(current) };
      throw paymentError(409, "PAYMENT_CONFLICT", "Another payment has already been recorded for this order.");
    }
    let session;
    try {
      session = await startSession();
      await session.withTransaction(async () => {
        const current = await owned(String(order._id), order.user, session);
        if (current.status === "confirmed" && current.providerPaymentId === payment.id) return;
        if (current.status !== "pending_payment" || current.providerPaymentId !== payment.id || current.stockDeductedAt) throw paymentError(409, "PAYMENT_CONFLICT", "The order changed during payment confirmation.");
        snapshot(current);
        for (const item of current.items) {
          const result = await inventory.updateOne({ _id: item.ingredientId, category: item.category, stock: { $gte: item.quantity } }, { $inc: { stock: -item.quantity } }, { session, runValidators: true });
          if (result.modifiedCount !== 1) throw paymentError(409, "INSUFFICIENT_STOCK", "Payment was captured, but some ingredients are unavailable. Contact the administrator; do not pay again.");
        }
        const at = now();
        const result = await orders.updateOne({ _id: current._id, status: "pending_payment", providerPaymentId: payment.id, stockDeductedAt: null }, {
          $set: { status: "confirmed", paymentStatus: "paid", confirmedAt: at, stockDeductedAt: at, fulfillmentStatus: "order_received", fulfillmentHistory: [{ status: "order_received", at }] },
          $unset: { paymentIssue: 1 },
        }, { session, runValidators: true });
        if (result.modifiedCount !== 1) throw paymentError(409, "PAYMENT_CONFLICT", "The order changed during payment confirmation.");
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } catch (cause) {
      const issue = cause.code === "INSUFFICIENT_STOCK" ? "INSUFFICIENT_STOCK" : "PAYMENT_CONFIRMATION_PENDING";
      await orders.updateOne({ _id: order._id, status: "pending_payment", providerPaymentId: payment.id }, { $set: { paymentStatus: "review_required", paymentIssue: issue } });
      throw paymentError(cause.status || 503, issue, cause.code === "INSUFFICIENT_STOCK" ? cause.message : "Payment was captured but confirmation needs a retry. Check payment status; do not pay again.", { order: profile(await owned(String(order._id), order.user)) });
    } finally { if (session) await session.endSession(); }
    return { order: profile(await owned(String(order._id), order.user)) };
  }
  async function confirm(id, user, body) {
    const order = await owned(id, user);
    const fields = ["razorpay_order_id", "razorpay_payment_id", "razorpay_signature"];
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 3 || Object.keys(body).some(field => !fields.includes(field)) ||
      !/^order_[A-Za-z\d]+$/.test(body.razorpay_order_id || "") || !/^pay_[A-Za-z\d]+$/.test(body.razorpay_payment_id || "")) throw paymentError(400, "INVALID_PAYMENT", "Provide the Razorpay payment confirmation fields.");
    snapshot(order); await requireAvailable(); sameAccount(order);
    if (!order.providerOrderId || body.razorpay_order_id !== order.providerOrderId || !provider.verifySignature(order.providerOrderId, body.razorpay_payment_id, body.razorpay_signature)) throw paymentError(400, "INVALID_SIGNATURE", "Payment signature verification failed.");
    return settle(order, await verifyProvider(order, body.razorpay_payment_id));
  }
  async function reconcile(id, user) {
    let order = await owned(id, user);
    if (order.status === "confirmed" && order.paymentStatus === "paid") return { order: profile(order) };
    snapshot(order); await requireAvailable(); sameAccount(order);
    if (!order.providerOrderId && order.paymentIssue) {
      if (order.paymentIssue === "PAYMENT_SETUP_IN_PROGRESS" && now() - new Date(order.paymentCreationStartedAt) <= 120000) throw paymentError(409, "PAYMENT_SETUP_IN_PROGRESS", "Payment setup is still running. Check status shortly.", { order: profile(order) });
      const recovered = await provider.findOrders(`pizza_${id}`);
      if (!Array.isArray(recovered?.items) || !Number.isInteger(recovered.count) || recovered.count !== recovered.items.length) throw paymentError(503, "PROVIDER_UNAVAILABLE", "Payment setup could not be recovered. Try again later.");
      const match = recovered.items.length === 1 && recovered.items[0];
      if (!match || !/^order_[A-Za-z\d]+$/.test(match.id || "") || match.receipt !== `pizza_${id}` || match.amount !== order.totalMinor || match.currency !== "EUR") throw paymentError(409, "PAYMENT_SETUP_REVIEW", "Payment setup is uncertain. Contact the administrator; do not start a new payment.", { order: profile(order) });
      order = await orders.findOneAndUpdate({ _id: id, user, providerOrderId: null }, { $set: { providerOrderId: match.id }, $unset: { paymentIssue: 1, paymentCreationToken: 1 } }, { returnDocument: "after", runValidators: true }) || await owned(id, user);
    }
    if (!order.providerOrderId) return { order: profile(order) };
    const payments = await provider.listPayments(order.providerOrderId);
    if (!Array.isArray(payments?.items) || !Number.isInteger(payments.count) || payments.count !== payments.items.length ||
      payments.items.some(payment => !/^pay_[A-Za-z\d]+$/.test(payment?.id || "") || payment.order_id !== order.providerOrderId || !["created", "authorized", "captured", "refunded", "failed"].includes(payment.status))) throw paymentError(503, "PROVIDER_UNAVAILABLE", "Payment status could not be read safely. Try again later.");
    const captured = payments.items.filter(payment => payment.status === "captured");
    if (captured.length > 1 || payments.items.some(payment => payment.status === "refunded")) {
      order = await orders.findOneAndUpdate({ _id: id, user, status: "pending_payment" }, { $set: { paymentStatus: "review_required", paymentIssue: "PAYMENT_REVIEW_REQUIRED" } }, { returnDocument: "after" }) || order;
      throw paymentError(409, "PAYMENT_REVIEW_REQUIRED", "Captured or refunded payments need administrator review. Do not pay again.", { order: profile(order) });
    }
    if (captured.length === 1) return settle(order, await verifyProvider(order, captured[0].id));
    if (order.providerPaymentId || order.paymentStatus === "review_required") throw paymentError(409, "PAYMENT_REVIEW_REQUIRED", "A recorded capture needs administrator review. Do not pay again.", { order: profile(order) });
    if (payments.items.some(payment => ["authorized", "created"].includes(payment.status))) {
      order = await orders.findOneAndUpdate({ _id: id, user, status: "pending_payment", providerPaymentId: null }, { $set: { paymentIssue: "PAYMENT_PROCESSING" } }, { returnDocument: "after" }) || order;
      throw paymentError(409, "PAYMENT_PROCESSING", "Payment is authorized and awaiting capture. Check status later; do not pay again.", { order: profile(order) });
    }
    if (order.paymentIssue === "PAYMENT_PROCESSING") order = await orders.findOneAndUpdate({ _id: id, user, status: "pending_payment", providerPaymentId: null, paymentIssue: "PAYMENT_PROCESSING" }, { $unset: { paymentIssue: 1 } }, { returnDocument: "after" }) || await owned(id, user);
    return { order: profile(order) };
  }
  return { config, initiate, confirm, reconcile };
}

module.exports = { createPaymentService, supportsTransactions };
