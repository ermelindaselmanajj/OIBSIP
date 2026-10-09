import { parseOrder } from "./orderHelpers.js";

export const checkoutScript = "https://checkout.razorpay.com/v1/checkout.js";

export function parsePaymentConfig(data) {
  if (!data || typeof data.available !== "boolean" || data.mode !== "test" || data.currency !== "EUR" ||
    !(data.code === null || typeof data.code === "string") || !(data.message === null || typeof data.message === "string")) {
    throw new Error("We couldn't check payment availability. Please retry.");
  }
  return data;
}

export function parsePaymentSession(data, expectedOrder) {
  const order = parseOrder(data?.order);
  if (order.id !== expectedOrder.id || order.totalMinor !== expectedOrder.totalMinor || order.currency !== expectedOrder.currency) {
    throw new Error("The checkout doesn't match this order. Refresh before trying again.");
  }
  if (data.checkout === null && order.paymentStatus === "paid" && order.status === "confirmed") return { order, checkout: null };
  const checkout = data.checkout;
  if (!checkout || !/^rzp_test_[A-Za-z0-9]+$/.test(checkout.keyId) ||
    !/^order_[A-Za-z0-9]+$/.test(checkout.providerOrderId) || checkout.currency !== "EUR" ||
    order.currency !== "EUR" || checkout.amountMinor !== order.totalMinor || !Number.isSafeInteger(checkout.amountMinor) || checkout.amountMinor <= 0 ||
    typeof checkout.name !== "string" || !checkout.name.trim() || typeof checkout.description !== "string" ||
    order.paymentStatus !== "pending" || !order.checkoutEligible) {
    throw new Error("We couldn't read the test checkout details. Please retry.");
  }
  return { order, checkout };
}

export function paymentCallback(data, providerOrderId) {
  if (!data || data.razorpay_order_id !== providerOrderId || !/^pay_[A-Za-z0-9]+$/.test(data.razorpay_payment_id) ||
    !/^[a-f0-9]{64}$/.test(data.razorpay_signature)) {
    throw new Error("The payment response couldn't be verified. Check payment status before trying again.");
  }
  return { razorpay_order_id: data.razorpay_order_id, razorpay_payment_id: data.razorpay_payment_id, razorpay_signature: data.razorpay_signature };
}

export function paymentError(failure) {
  const code = failure.response?.data?.code;
  if (code === "INSUFFICIENT_STOCK") return failure.response?.data?.order?.paymentStatus === "review_required"
    ? "A payment was received, but there isn't enough stock to confirm this order. Do not pay again. Contact the administrator or check payment status after restocking."
    : "There isn't enough ingredient stock for this order. Refresh your choices or lower the quantity before checkout.";
  if (code === "PAYMENT_NOT_CAPTURED" || code === "PAYMENT_PROCESSING") return "The payment isn't captured yet. Check payment status before starting another payment.";
  if (code === "PAYMENT_CONFIRMATION_PENDING") return "Payment confirmation is still pending. Do not pay again; check payment status to retry confirmation.";
  return failure.response?.data?.message || failure.message || "We couldn't complete this payment request. Check payment status before trying again.";
}

export function loadRazorpay(window, document, setTimer = setTimeout, clearTimer = clearTimeout) {
  if (typeof window.Razorpay === "function") return Promise.resolve(window.Razorpay);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = checkoutScript;
    script.async = true;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      script.onload = null;
      script.onerror = null;
      if (error) { script.remove(); reject(error); }
      else resolve(window.Razorpay);
    };
    const timer = setTimer(() => finish(new Error("The payment window took too long to load. Please retry.")), 15000);
    script.onload = () => finish(typeof window.Razorpay === "function" ? null : new Error("The payment window didn't load correctly. Please retry."));
    script.onerror = () => finish(new Error("The payment window couldn't load. Check your connection and retry."));
    document.head.appendChild(script);
  });
}

export function checkoutOptions(checkout, callbacks) {
  return {
    key: checkout.keyId, order_id: checkout.providerOrderId,
    amount: checkout.amountMinor, currency: checkout.currency,
    name: checkout.name, description: checkout.description,
    theme: { color: "#b94d16" },
    handler: callbacks.onSuccess,
    modal: { ondismiss: callbacks.onDismiss },
    retry: { enabled: false },
  };
}
