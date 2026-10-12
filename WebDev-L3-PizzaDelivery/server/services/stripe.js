const { createHash, createHmac, timingSafeEqual } = require("node:crypto");
const { paymentError } = require("./razorpay");

function configuration(env = process.env) {
  const webhookConfigured = /^whsec_[A-Za-z\d]+$/.test(env.STRIPE_WEBHOOK_SECRET || "");
  if (!env.STRIPE_SECRET_KEY) return { available: false, webhookConfigured, code: "PAYMENT_KEYS_MISSING", message: "Stripe test checkout is unavailable until a test secret key is configured." };
  if (!/^sk_test_[A-Za-z\d]+$/.test(env.STRIPE_SECRET_KEY)) return { available: false, webhookConfigured, code: "TEST_MODE_REQUIRED", message: "Only Stripe test-mode secret keys are supported." };
  return { available: true, webhookConfigured, code: null, message: null };
}

function verifyWebhook(raw, header, secret, now = Date.now()) {
  if (!Buffer.isBuffer(raw) || typeof header !== "string" || !/^whsec_[A-Za-z\d]+$/.test(secret || "")) throw paymentError(400, "INVALID_WEBHOOK_SIGNATURE", "Stripe webhook signature verification failed.");
  const parts = header.split(",").map(value => value.trim().split("="));
  const times = parts.filter(([key]) => key === "t");
  const signatures = parts.filter(([key, value]) => key === "v1" && /^[a-f\d]{64}$/i.test(value || ""));
  if (times.length !== 1 || !/^\d+$/.test(times[0][1]) || !Number.isSafeInteger(Number(times[0][1])) || Math.abs(now / 1000 - Number(times[0][1])) > 300 || !signatures.length) throw paymentError(400, "INVALID_WEBHOOK_SIGNATURE", "Stripe webhook signature verification failed.");
  const digest = createHmac("sha256", secret).update(`${times[0][1]}.`).update(raw).digest();
  if (!signatures.some(([, signature]) => timingSafeEqual(digest, Buffer.from(signature, "hex")))) throw paymentError(400, "INVALID_WEBHOOK_SIGNATURE", "Stripe webhook signature verification failed.");
  let event;
  try { event = JSON.parse(raw.toString("utf8")); }
  catch { throw paymentError(400, "INVALID_WEBHOOK", "Stripe webhook body is invalid."); }
  if (!event || !/^evt_[A-Za-z\d]+$/.test(event.id || "") || event.livemode !== false || typeof event.type !== "string" || !event.data?.object) throw paymentError(400, "INVALID_WEBHOOK", "Only valid Stripe test-mode events are accepted.");
  return event;
}

function createStripe({ env = process.env, request = fetch, now = () => Date.now() } = {}) {
  async function api(method, endpoint, body, idempotencyKey) {
    const config = configuration(env);
    if (!config.available) throw paymentError(503, config.code, config.message);
    let response;
    try {
      response = await request(`https://api.stripe.com/v1${endpoint}`, {
        method,
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
        body: body === undefined ? undefined : new URLSearchParams(body).toString(), signal: AbortSignal.timeout(15000),
      });
    } catch { throw paymentError(503, "PROVIDER_UNAVAILABLE", "Stripe could not be reached. Check payment status before trying again."); }
    if (!response.ok) throw paymentError(503, "PROVIDER_UNAVAILABLE", "Stripe rejected the request. Check test-mode access and configuration privately.");
    try { return await response.json(); }
    catch { throw paymentError(503, "PROVIDER_UNAVAILABLE", "Stripe returned an unreadable response. Check payment status before trying again."); }
  }
  return {
    configuration: () => configuration(env),
    accountKey: () => createHash("sha256").update(env.STRIPE_SECRET_KEY || "").digest("hex"),
    createSession: (body, key) => api("POST", "/checkout/sessions", body, key),
    getSession: id => api("GET", `/checkout/sessions/${encodeURIComponent(id)}?expand[]=payment_intent.latest_charge`),
    verifyWebhook: (raw, header) => {
      if (!configuration(env).webhookConfigured) throw paymentError(503, "WEBHOOK_UNAVAILABLE", "Stripe webhook verification is not configured.");
      return verifyWebhook(raw, header, env.STRIPE_WEBHOOK_SECRET, now());
    },
  };
}

module.exports = { createStripe, configuration, verifyWebhook };
