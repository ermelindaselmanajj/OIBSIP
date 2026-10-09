export const fulfillmentStages = ["order_received", "in_kitchen", "sent_to_delivery"];
export const stageLabels = { order_received: "Order Received", in_kitchen: "In Kitchen", sent_to_delivery: "Sent to Delivery" };
export const paymentLabel = (order) => order.paymentStatus === "review_required" ? "Payment needs review" : order.paymentStatus === "paid" ? "Payment confirmed" : "Payment pending";

export function nextAction(order) {
  if (order.paymentStatus !== "paid" || order.status !== "confirmed") return null;
  const index = fulfillmentStages.indexOf(order.fulfillmentStatus);
  if (index < 0) return null;
  const expected = fulfillmentStages[index + 1] || null;
  return order.nextFulfillmentStatus === expected ? expected : null;
}

export function validateTracking(order) {
  const date = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
  if (!["pending_payment", "confirmed"].includes(order.status) || !["pending", "paid", "review_required"].includes(order.paymentStatus) ||
    !(order.fulfillmentStatus === null || fulfillmentStages.includes(order.fulfillmentStatus)) ||
    !Array.isArray(order.fulfillmentHistory) || order.fulfillmentHistory.some((entry) => !fulfillmentStages.includes(entry.status) || !date(entry.at)) ||
    !(order.confirmedAt === null || date(order.confirmedAt)) || !date(order.updatedAt) ||
    !(order.nextFulfillmentStatus === null || fulfillmentStages.includes(order.nextFulfillmentStatus))) {
    throw new Error("We couldn't read the order tracking details. Please retry.");
  }
  return order;
}

export function parseOrderList(data, parseOrder) {
  if (!Array.isArray(data?.orders) || !data.pagination ||
    ![data.pagination.page, data.pagination.limit, data.pagination.total, data.pagination.pages].every(Number.isInteger) ||
    data.pagination.page < 1 || data.pagination.limit < 1 || data.pagination.total < 0 || data.pagination.pages < 0) {
    throw new Error("We couldn't read the order list. Please retry.");
  }
  return { orders: data.orders.map(parseOrder), pagination: data.pagination };
}
