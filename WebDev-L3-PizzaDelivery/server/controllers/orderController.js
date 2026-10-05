const Order = require("../models/Order");
const { normalizeSelection, selectionHash, buildQuote, error } = require("../services/orderQuote");
const { CURRENCY } = require("../services/pricing");
let indexesReady;
const ensureIndexes = () => {
  if (!indexesReady) indexesReady = Order.createIndexes().catch(failure => { indexesReady = undefined; throw failure; });
  return indexesReady;
};
const profile = order => ({
  id: String(order._id), status: order.status, currency: order.currency, checkoutEligible: order.currency === CURRENCY, quantity: order.quantity,
  items: order.items.map(item => ({ ingredientId: String(item.ingredientId), name: item.name, category: item.category, unitPriceMinor: item.unitPriceMinor, quantity: item.quantity, lineTotalMinor: item.lineTotalMinor })),
  unitTotalMinor: order.unitTotalMinor, totalMinor: order.totalMinor, createdAt: order.createdAt,
});
const failure = (res, cause) => {
  if (!cause.status) return res.status(500).json({ message: "Server error" });
  const body = { message: cause.message, code: cause.code };
  if (cause.ingredientIds) body.ingredientIds = cause.ingredientIds;
  if (cause.quote) body.quote = cause.quote;
  return res.status(cause.status).json(body);
};
const replay = (order, payloadHash, res) => {
  if (order.selectionHash !== payloadHash) throw error(409, "IDEMPOTENCY_CONFLICT", "This idempotency key was already used for another selection.");
  return res.status(200).json({ order: profile(order) });
};
const quoteOrder = async (req, res) => {
  try { return res.json({ quote: await buildQuote(normalizeSelection(req.body)) }); }
  catch (cause) { return failure(res, cause); }
};
const createOrder = async (req, res) => {
  try {
    const selection = normalizeSelection(req.body, true);
    const payloadHash = selectionHash(selection);
    const owner = { user: req.identity._id, idempotencyKey: req.body.idempotencyKey };
    const existing = await Order.findOne(owner);
    if (existing) return replay(existing, payloadHash, res);
    await ensureIndexes();
    const quote = await buildQuote(selection);
    if (quote.fingerprint !== req.body.quoteFingerprint.toLowerCase()) {
      throw error(409, "PRICE_CHANGED", "Your quote changed. Review the updated price before saving.", { quote });
    }
    try {
      const { fingerprint, ...snapshot } = quote;
      const order = await Order.create({ ...owner, ...snapshot, selectionHash: payloadHash, status: "pending_payment" });
      return res.status(201).json({ order: profile(order) });
    } catch (cause) {
      if (cause.code !== 11000) throw cause;
      const concurrent = await Order.findOne(owner);
      if (!concurrent) throw cause;
      return replay(concurrent, payloadHash, res);
    }
  } catch (cause) { return failure(res, cause); }
};
const getOrder = async (req, res) => {
  if (typeof req.params.id !== "string" || !/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ message: "Invalid order ID" });
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.identity._id, status: "pending_payment" });
    if (!order) return res.status(404).json({ message: "Order not found" });
    return res.json({ order: profile(order) });
  } catch (cause) { return failure(res, cause); }
};
const getOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.identity._id, status: "pending_payment" }).sort({ createdAt: -1 });
    return res.json({ orders: orders.map(profile) });
  } catch (cause) { return failure(res, cause); }
};
module.exports = { quoteOrder, createOrder, getOrder, getOrders };
