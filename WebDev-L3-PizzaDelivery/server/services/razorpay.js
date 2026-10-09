const crypto = require("node:crypto");

const paymentError = (status, code, message, details = {}) => Object.assign(new Error(message), { status, code, ...details });

function configuration(env = process.env) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return { available: false, code: "PAYMENT_KEYS_MISSING", message: "Test payments are unavailable until Razorpay test keys are configured." };
  if (!/^rzp_test_[A-Za-z\d]+$/.test(env.RAZORPAY_KEY_ID)) return { available: false, code: "TEST_MODE_REQUIRED", message: "Only Razorpay test-mode keys are supported." };
  if (env.RAZORPAY_EUR_ENABLED !== "true") return { available: false, code: "EUR_NOT_ENABLED", message: "EUR payments require merchant activation. Enable test checkout only after confirming EUR support with Razorpay." };
  return { available: true, code: null, message: null };
}

function validSignature(orderId, paymentId, signature, secret) {
  if (typeof signature !== "string" || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

function createRazorpay({ env = process.env, request = fetch } = {}) {
  async function api(method, endpoint, body) {
    const config = configuration(env);
    if (!config.available) throw paymentError(503, config.code, config.message);
    let response;
    try {
      response = await request(`https://api.razorpay.com/v1${endpoint}`, {
        method, headers: { Authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64")}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
    } catch { throw paymentError(503, "PROVIDER_UNAVAILABLE", "Razorpay could not be reached. Check payment status before trying again."); }
    if (!response.ok) {
      throw paymentError(503, "PROVIDER_UNAVAILABLE", "Razorpay rejected the request. Check test-mode access and EUR activation.", { definitiveRejection: response.status >= 400 && response.status < 500 && response.status !== 429 });
    }
    try { return await response.json(); }
    catch { throw paymentError(503, "PROVIDER_UNAVAILABLE", "Razorpay returned an unreadable response. Check payment status before trying again."); }
  }
  return {
    configuration: () => configuration(env), publicKey: () => env.RAZORPAY_KEY_ID,
    verifySignature: (orderId, paymentId, signature) => validSignature(orderId, paymentId, signature, env.RAZORPAY_KEY_SECRET),
    createOrder: body => api("POST", "/orders", body),
    getOrder: id => api("GET", `/orders/${encodeURIComponent(id)}`),
    getPayment: id => api("GET", `/payments/${encodeURIComponent(id)}`),
    listPayments: id => api("GET", `/orders/${encodeURIComponent(id)}/payments`),
    findOrders: receipt => api("GET", `/orders?receipt=${encodeURIComponent(receipt)}&count=2`),
  };
}

module.exports = { createRazorpay, configuration, validSignature, paymentError };
