const Order = require("../models/Order");
const { profile, stages, parseList, supportedFilter, isSupported } = require("../services/orderTracking");
const validId = id => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);
const notFound = res => res.status(404).json({ message: "Order not found" });
const conflict = res => res.status(409).json({ message: "Order is not paid and confirmed, or its fulfillment stage changed.", code: "FULFILLMENT_CONFLICT" });
const getAdminOrders = async (req, res) => {
  let options;
  try { options = parseList(req.query); }
  catch { return res.status(400).json({ message: "Invalid order filters or pagination" }); }
  try {
    const { page, limit, filter } = options;
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
      Order.countDocuments(filter),
    ]);
    return res.json({ orders: orders.map(profile), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch { return res.status(500).json({ message: "Server error" }); }
};
const getAdminOrder = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid order ID" });
  try {
    const order = await Order.findOne({ _id: req.params.id, ...supportedFilter() });
    return order ? res.json({ order: profile(order) }) : notFound(res);
  } catch { return res.status(500).json({ message: "Server error" }); }
};
const updateFulfillment = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid order ID" });
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 2 ||
      Object.keys(body).some(key => !["status", "expectedStatus"].includes(key)) ||
      !stages.includes(body.status) || !stages.includes(body.expectedStatus)) {
    return res.status(400).json({ message: "Provide status and expectedStatus fulfillment stages" });
  }
  if (stages.indexOf(body.status) !== stages.indexOf(body.expectedStatus) + 1) return conflict(res);
  try {
    const initial = await Order.findOne({ _id: req.params.id });
    if (!isSupported(initial)) return notFound(res);
    if (initial.status !== "confirmed" || initial.paymentStatus !== "paid") return conflict(res);
    if (initial.fulfillmentStatus === body.status) return res.json({ order: profile(initial) });
    if (initial.fulfillmentStatus !== body.expectedStatus) return conflict(res);
    const at = new Date();
    const updated = await Order.findOneAndUpdate({
      _id: req.params.id, status: "confirmed", paymentStatus: "paid", fulfillmentStatus: body.expectedStatus,
    }, {
      $set: { fulfillmentStatus: body.status }, $push: { fulfillmentHistory: { status: body.status, at } },
    }, { new: true, runValidators: true });
    if (updated) return res.json({ order: profile(updated) });
    const concurrent = await Order.findOne({ _id: req.params.id });
    if (!isSupported(concurrent)) return notFound(res);
    if (concurrent.status === "confirmed" && concurrent.paymentStatus === "paid" && concurrent.fulfillmentStatus === body.status) return res.json({ order: profile(concurrent) });
    return conflict(res);
  } catch { return res.status(500).json({ message: "Server error" }); }
};
module.exports = { getAdminOrders, getAdminOrder, updateFulfillment };
