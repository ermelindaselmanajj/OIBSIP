import { parseOrder } from "./orderHelpers.js";

export function parsePaymentConfig(data) {
  if (!data || typeof data.available !== "boolean" || data.provider !== "stripe" || data.mode !== "test" || data.currency !== "EUR" ||
    typeof data.webhookConfigured !== "boolean" ||
    !(data.code === null || typeof data.code === "string") || !(data.message === null || typeof data.message === "string")) {
    throw new Error("We couldn't check payment availability. Please retry.");
  }
  return data;
}

export function checkoutUrl(value) {
  try {
    const url = new URL(value);
    if (typeof value !== "string" || url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" ||
      url.username || url.password || url.port || !url.pathname.startsWith("/c/pay/")) throw new Error();
    return url.href;
  } catch {
    throw new Error("We couldn't read the secure Stripe checkout link. Please retry.");
  }
}

export function parsePaymentSession(data, expectedOrder) {
  const order = parseOrder(data?.order);
  if (order.id !== expectedOrder.id || order.totalMinor !== expectedOrder.totalMinor || order.currency !== expectedOrder.currency) {
    throw new Error("The checkout doesn't match this order. Refresh before trying again.");
  }
  if (data.checkout === null && order.paymentStatus === "paid" && order.status === "confirmed") return { order, checkout: null };
  const checkout = data.checkout;
  if (!checkout || checkout.provider !== "stripe" || !/^cs_test_[A-Za-z0-9]+$/.test(checkout.sessionId) ||
    checkout.currency !== "EUR" || order.currency !== "EUR" || checkout.amountMinor !== order.totalMinor ||
    !Number.isSafeInteger(checkout.amountMinor) || checkout.amountMinor <= 0 ||
    order.paymentProvider !== "stripe" || order.paymentStatus !== "pending" || !order.checkoutEligible) {
    throw new Error("We couldn't read the test checkout details. Please retry.");
  }
  return { order, checkout: { ...checkout, url: checkoutUrl(checkout.url) } };
}

export function paymentReturn(search) {
  const value = new URLSearchParams(search).get("payment");
  return ["success", "cancelled"].includes(value) ? value : null;
}

export function paymentError(failure) {
  const code = failure.response?.data?.code;
  if (code === "INSUFFICIENT_STOCK") return failure.response?.data?.order?.paymentStatus === "review_required"
    ? "A payment was received, but there isn't enough stock to confirm this order. Do not pay again. Contact the administrator or check payment status after restocking."
    : "There isn't enough ingredient stock for this order. Refresh your choices or lower the quantity before checkout.";
  if (code === "PAYMENT_NOT_CAPTURED" || code === "PAYMENT_PROCESSING") return "The payment is still processing. Check payment status before starting another payment.";
  if (code === "PAYMENT_CONFIRMATION_PENDING") return "Payment confirmation is still pending. Do not pay again; check payment status to retry confirmation.";
  if (code === "PAYMENT_PROVIDER_PRESERVED") return "This order already uses Razorpay. It cannot switch to Stripe. Check its payment status before creating a new order.";
  return failure.response?.data?.message || failure.message || "We couldn't complete this payment request. Check payment status before trying again.";
}
