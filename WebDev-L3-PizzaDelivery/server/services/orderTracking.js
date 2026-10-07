const { CURRENCY } = require("./pricing");
const stages = ["order_received", "in_kitchen", "sent_to_delivery"];
const supportedFilter = () => ({ status: { $in: ["pending_payment", "confirmed"] }, currency: { $in: ["EUR", "INR"] }, "items.0": { $exists: true } });
const nextStage = order => order.status === "confirmed" && order.paymentStatus === "paid" && stages.includes(order.fulfillmentStatus) ? stages[stages.indexOf(order.fulfillmentStatus) + 1] || null : null;
const iso = value => value == null ? null : new Date(value).toISOString();
const profile = order => ({
  id: String(order._id), status: order.status, currency: order.currency,
  checkoutEligible: order.status === "pending_payment" && order.currency === CURRENCY,
  quantity: order.quantity,
  items: order.items.map(item => ({ ingredientId: String(item.ingredientId), name: item.name, category: item.category, unitPriceMinor: item.unitPriceMinor, quantity: item.quantity, lineTotalMinor: item.lineTotalMinor })),
  unitTotalMinor: order.unitTotalMinor, totalMinor: order.totalMinor, createdAt: iso(order.createdAt), updatedAt: iso(order.updatedAt),
  paymentStatus: order.paymentStatus === "paid" ? "paid" : "pending",
  fulfillmentStatus: order.fulfillmentStatus || null,
  fulfillmentHistory: (order.fulfillmentHistory || []).map(event => ({ status: event.status, at: iso(event.at) })),
  confirmedAt: iso(order.confirmedAt), nextFulfillmentStatus: nextStage(order),
});
const parseList = (query = {}) => {
  const allowed = ["page", "limit", "paymentStatus", "fulfillmentStatus"];
  if (Object.keys(query).some(key => !allowed.includes(key))) throw new Error("Invalid order query");
  const integer = (value, fallback, max) => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw new Error("Invalid pagination");
    return Number(value);
  };
  const page = integer(query.page, 1, Number.MAX_SAFE_INTEGER);
  const limit = integer(query.limit, 20, 100);
  if (!Number.isSafeInteger((page - 1) * limit)) throw new Error("Invalid pagination");
  const paymentStatus = query.paymentStatus === undefined ? "all" : query.paymentStatus;
  const fulfillmentStatus = query.fulfillmentStatus === undefined ? "all" : query.fulfillmentStatus;
  if (!["all", "pending", "paid"].includes(paymentStatus) || !["all", "not_started", ...stages].includes(fulfillmentStatus)) throw new Error("Invalid order filter");
  const clauses = [supportedFilter()];
  if (paymentStatus === "paid") clauses.push({ paymentStatus: "paid" });
  if (paymentStatus === "pending") clauses.push({ $or: [{ paymentStatus: "pending" }, { paymentStatus: { $exists: false } }, { paymentStatus: null }] });
  if (fulfillmentStatus === "not_started") clauses.push({ fulfillmentStatus: null });
  else if (fulfillmentStatus !== "all") clauses.push({ fulfillmentStatus });
  return { page, limit, filter: { $and: clauses } };
};
const isSupported = order => order && ["pending_payment", "confirmed"].includes(order.status) && ["EUR", "INR"].includes(order.currency) && Array.isArray(order.items) && order.items.length > 0;
module.exports = { profile, stages, nextStage, parseList, supportedFilter, isSupported };
