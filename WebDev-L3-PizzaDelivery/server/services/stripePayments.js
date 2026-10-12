const { randomUUID } = require("node:crypto");
const Order = require("../models/Order");
const { createPaymentService, supportsTransactions } = require("./payments");
const { createStripe } = require("./stripe");
const { paymentError } = require("./razorpay");
const { paymentProvider, profile } = require("./orderTracking");
const { clientUrl } = require("../config/urls");

const validSessionId = id => typeof id === "string" && /^cs_test_[A-Za-z\d]+$/.test(id);
const paid = order => order.status === "confirmed" && order.paymentStatus === "paid";

function createStripePaymentService({ orders = Order, provider = createStripe(), legacy,
  clientOrigin = clientUrl, now = () => new Date(), transactionsSupported = supportsTransactions, ...dependencies } = {}) {
  const shared = createPaymentService({ ...dependencies, orders, transactionsSupported });
  const razorpay = legacy || shared;
  let indexesReady;
  async function config() {
    const result = { ...provider.configuration(), provider: "stripe", mode: "test", currency: "EUR" };
    if (!result.available) return result;
    return await transactionsSupported() ? result : { ...result, available: false, code: "TRANSACTIONS_REQUIRED", message: "Checkout requires a MongoDB replica set with transaction support." };
  }
  async function requireAvailable() {
    const result = await config();
    if (!result.available) throw paymentError(503, result.code, result.message);
    if (!indexesReady) indexesReady = orders.createIndexes().catch(cause => { indexesReady = undefined; throw cause; });
    await indexesReady;
  }
  function sameAccount(order) {
    if (order.providerKeyId && order.providerKeyId !== provider.accountKey()) throw paymentError(409, "PAYMENT_ACCOUNT_CHANGED", "This order belongs to a different Stripe test-key configuration. Contact the administrator; do not pay again.", { order: profile(order) });
  }
  function sessionMatches(order, session) {
    if (!validSessionId(session?.id) || (order.providerOrderId && session.id !== order.providerOrderId) || session.livemode !== false || session.mode !== "payment" ||
      session.amount_total !== order.totalMinor || session.currency !== "eur" || session.client_reference_id !== String(order._id) || session.metadata?.pizzaOrderId !== String(order._id) || session.metadata?.userId !== String(order.user) ||
      !["open", "complete", "expired"].includes(session.status) || !["paid", "unpaid", "no_payment_required"].includes(session.payment_status)) {
      throw paymentError(409, "PAYMENT_MISMATCH", "Stripe's payment does not match this order, amount, currency or test mode.");
    }
  }
  function intentMatches(order, intent) {
    if (!intent || typeof intent !== "object" || !/^pi_[A-Za-z\d]+$/.test(intent.id || "") || intent.livemode !== false || intent.amount !== order.totalMinor || intent.currency !== "eur" ||
      intent.metadata?.pizzaOrderId !== String(order._id) || intent.metadata?.userId !== String(order.user)) throw paymentError(409, "PAYMENT_MISMATCH", "Stripe's payment intent does not match this order.");
  }
  async function verifyAndSettle(order, session) {
    sessionMatches(order, session);
    const intent = session.payment_intent;
    intentMatches(order, intent);
    const charge = intent.latest_charge;
    if (session.status !== "complete" || session.payment_status !== "paid" || intent.status !== "succeeded" || intent.amount_received !== order.totalMinor || intent.capture_method !== "automatic" ||
      !charge || typeof charge !== "object" || !/^ch_[A-Za-z\d]+$/.test(charge.id || "") || charge.livemode !== false || charge.payment_intent !== intent.id || charge.currency !== "eur" || charge.amount !== order.totalMinor ||
      charge.paid !== true || charge.captured !== true || charge.refunded !== false || charge.amount_refunded !== 0) throw paymentError(409, "PAYMENT_NOT_CAPTURED", "Stripe has not confirmed a complete, unrefunded payment. Check payment status; do not assume confirmation.");
    return shared.settle(order, { id: intent.id });
  }
  function checkout(order, session) {
    let url;
    try { url = new URL(session.url); } catch { /* validated below */ }
    if (!url || url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.port || !url.pathname.startsWith("/c/pay/") || url.username || url.password) throw paymentError(503, "PROVIDER_UNAVAILABLE", "Stripe did not provide a valid hosted checkout URL.");
    return { order: profile(order), checkout: { provider: "stripe", sessionId: session.id, url: url.href, amountMinor: order.totalMinor, currency: "EUR" } };
  }
  const creationKey = order => `pizza_checkout_${order._id}_${order.stripeCheckoutAttempt || 0}`;
  function creationPayload(order) {
    const origin = clientOrigin();
    return {
      mode: "payment", "payment_method_types[0]": "card",
      client_reference_id: String(order._id), "metadata[pizzaOrderId]": String(order._id), "metadata[userId]": String(order.user),
      "payment_intent_data[metadata][pizzaOrderId]": String(order._id), "payment_intent_data[metadata][userId]": String(order.user), "payment_intent_data[capture_method]": "automatic",
      "line_items[0][price_data][currency]": "eur", "line_items[0][price_data][unit_amount]": String(order.unitTotalMinor),
      "line_items[0][price_data][product_data][name]": `Pizza order ${String(order._id).slice(-8)}`,
      "line_items[0][price_data][product_data][description]": order.items.map(item => item.name).join(", ").slice(0, 500),
      "line_items[0][quantity]": String(order.quantity),
      success_url: `${origin}/orders/${order._id}?payment=success`, cancel_url: `${origin}/orders/${order._id}?payment=cancelled`,
    };
  }
  async function createOrRecover(order) {
    if (!order.stripeCreationPayload || !order.paymentCreationStartedAt || now() - new Date(order.paymentCreationStartedAt) >= 23 * 60 * 60 * 1000) throw paymentError(409, "PAYMENT_SETUP_REVIEW", "Payment setup is uncertain and its safe retry window has expired. Contact the administrator; do not pay again.", { order: profile(order) });
    try {
      const session = await provider.createSession(order.stripeCreationPayload, creationKey(order));
      sessionMatches(order, session);
      const saved = await orders.findOneAndUpdate({ _id: order._id, user: order.user, paymentProvider: "stripe", providerOrderId: null, stripeCheckoutAttempt: order.stripeCheckoutAttempt }, {
        $set: { providerOrderId: session.id }, $unset: { paymentIssue: 1, paymentCreationToken: 1 },
      }, { returnDocument: "after", runValidators: true });
      const current = saved || await shared.owned(String(order._id), order.user);
      if (current.providerOrderId !== session.id) throw paymentError(409, "PAYMENT_SETUP_REVIEW", "Payment setup changed. Check status before retrying.");
      // A recovered creation response can already be complete. Always retrieve
      // authoritative expanded payment data rather than trusting cached creation.
      return { order: current, session: await provider.getSession(session.id) };
    } catch (cause) {
      await orders.updateOne({ _id: order._id, paymentProvider: "stripe", providerOrderId: null, stripeCheckoutAttempt: order.stripeCheckoutAttempt }, { $set: { paymentIssue: "PAYMENT_SETUP_REVIEW" }, $unset: { paymentCreationToken: 1 } });
      throw paymentError(cause.status || 503, cause.code || "PAYMENT_SETUP_REVIEW", "Stripe setup could not be completed safely. Check payment status to retry the same request; do not start another payment.", { order: profile(await shared.owned(String(order._id), order.user)) });
    }
  }
  async function readSession(order) {
    if (order.providerOrderId) return { order, session: await provider.getSession(order.providerOrderId) };
    if (order.paymentIssue) return createOrRecover(order);
    return { order, session: null };
  }
  async function observe(order, session) {
    sessionMatches(order, session);
    if (session.payment_status === "paid") return verifyAndSettle(order, session);
    if (order.providerPaymentId || order.paymentStatus === "review_required") throw paymentError(409, "PAYMENT_REVIEW_REQUIRED", "A recorded payment needs administrator review. Do not pay again.", { order: profile(order) });
    const intent = session.payment_intent;
    if (intent) {
      intentMatches(order, intent);
      if (!["requires_payment_method", "requires_confirmation", "requires_action", "processing", "requires_capture", "canceled", "succeeded"].includes(intent.status)) throw paymentError(409, "PAYMENT_MISMATCH", "Stripe returned an unknown payment state.");
      if (["processing", "requires_capture", "succeeded"].includes(intent.status)) {
        order = await orders.findOneAndUpdate({ _id: order._id, status: "pending_payment", providerOrderId: session.id, providerPaymentId: null }, { $set: { paymentIssue: "PAYMENT_PROCESSING" } }, { returnDocument: "after" }) || order;
        throw paymentError(409, "PAYMENT_PROCESSING", "Stripe is processing this payment. Check status later; do not pay again.", { order: profile(order) });
      }
    }
    if (session.status === "complete" || session.payment_status !== "unpaid") throw paymentError(409, "PAYMENT_NOT_CAPTURED", "Stripe has not confirmed this payment. Check status before paying again.");
    if (order.paymentIssue === "PAYMENT_PROCESSING") order = await orders.findOneAndUpdate({ _id: order._id, status: "pending_payment", providerOrderId: session.id, providerPaymentId: null, paymentIssue: "PAYMENT_PROCESSING" }, { $unset: { paymentIssue: 1 } }, { returnDocument: "after" }) || await shared.owned(String(order._id), order.user);
    return { order: profile(order) };
  }
  async function reconcile(id, user) {
    let order = await shared.owned(id, user);
    if (paymentProvider(order) === "razorpay") return razorpay.reconcile(id, user);
    if (paid(order)) return { order: profile(order) };
    shared.snapshot(order); await requireAvailable(); sameAccount(order);
    const result = await readSession(order);
    return result.session ? observe(result.order, result.session) : { order: profile(order) };
  }
  async function initiate(id, user) {
    let order = await shared.owned(id, user);
    if (paid(order)) return { order: profile(order), checkout: null };
    if (paymentProvider(order) === "razorpay") throw paymentError(409, "PAYMENT_PROVIDER_PRESERVED", "This order belongs to Razorpay. Check its original payment status or rebuild an unpaid order; it cannot be paid through Stripe.", { order: profile(order) });
    shared.snapshot(order); await requireAvailable(); sameAccount(order);
    if (order.paymentStatus === "review_required" || order.providerPaymentId) throw paymentError(409, "PAYMENT_REVIEW_REQUIRED", "A payment needs confirmation. Check payment status; do not pay again.", { order: profile(order) });
    if (order.providerOrderId || order.paymentIssue) {
      const result = await readSession(order); order = result.order;
      const checked = await observe(order, result.session);
      if (checked.order.status === "confirmed") return { order: checked.order, checkout: null };
      order = await shared.owned(id, user);
      if (result.session.status === "open") { await shared.checkStock(order); return checkout(order, result.session); }
      // Only a provider-confirmed expired, unpaid session can be replaced.
      if (result.session.status !== "expired" || (result.session.payment_intent && (!(["canceled", "requires_payment_method"].includes(result.session.payment_intent.status)) || result.session.payment_intent.latest_charge?.paid === true || result.session.payment_intent.latest_charge?.captured === true))) throw paymentError(409, "PAYMENT_PROCESSING", "The existing checkout cannot be replaced safely. Check payment status.");
      const expired = await orders.findOneAndUpdate({ _id: id, user, paymentProvider: "stripe", status: "pending_payment", providerOrderId: result.session.id, providerPaymentId: null, paymentStatus: { $ne: "review_required" } }, {
        $inc: { stripeCheckoutAttempt: 1 }, $unset: { providerOrderId: 1, paymentIssue: 1, paymentCreationStartedAt: 1, stripeCreationPayload: 1 },
      }, { returnDocument: "after" });
      if (!expired) throw paymentError(409, "PAYMENT_SETUP_IN_PROGRESS", "Another checkout request is running. Refresh payment status.");
      order = expired;
    }
    await shared.checkStock(order);
    const token = randomUUID(), payload = creationPayload(order);
    const locked = await orders.findOneAndUpdate({ _id: id, user, status: "pending_payment", providerOrderId: null, providerPaymentId: null, paymentIssue: null, paymentStatus: { $ne: "review_required" },
      $or: [{ paymentProvider: null }, { paymentProvider: "stripe" }] }, {
      $set: { paymentProvider: "stripe", paymentCreationToken: token, paymentCreationStartedAt: now(), paymentIssue: "PAYMENT_SETUP_IN_PROGRESS", providerKeyId: provider.accountKey(), stripeCheckoutAttempt: order.stripeCheckoutAttempt || 0, stripeCreationPayload: payload },
    }, { returnDocument: "after", runValidators: true });
    if (!locked) throw paymentError(409, "PAYMENT_SETUP_IN_PROGRESS", "Another checkout request is already running. Check payment status.", { order: profile(await shared.owned(id, user)) });
    const result = await createOrRecover(locked), observed = await observe(result.order, result.session);
    return observed.order.status === "confirmed" ? { order: observed.order, checkout: null } : checkout(result.order, result.session);
  }
  async function confirm(id, user, body) {
    const order = await shared.owned(id, user);
    if (paymentProvider(order) === "razorpay") return razorpay.confirm(id, user, body);
    if (body !== undefined && (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)) throw paymentError(400, "INVALID_PAYMENT_REQUEST", "Stripe confirmation accepts no client payment data. The server checks the saved checkout session.");
    return reconcile(id, user);
  }
  async function webhook(raw, signature) {
    const event = provider.verifyWebhook(raw, signature);
    if (!["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"].includes(event.type)) return { received: true, ignored: true };
    const session = event.data.object;
    if (!validSessionId(session.id) || session.livemode !== false || !/^[a-f\d]{24}$/i.test(session.metadata?.pizzaOrderId || "")) throw paymentError(400, "INVALID_WEBHOOK", "Stripe checkout event is invalid.");
    const order = await orders.findOne({ _id: session.metadata.pizzaOrderId, paymentProvider: "stripe" });
    if (!order) return { received: true, ignored: true };
    if (!order.providerOrderId) throw paymentError(503, "PAYMENT_SETUP_IN_PROGRESS", "Stripe checkout is still being saved. Retry this event.");
    if (order.providerOrderId !== session.id) return { received: true, ignored: true };
    await requireAvailable(); sameAccount(order); shared.snapshot(order);
    const remote = await provider.getSession(order.providerOrderId);
    try { await observe(order, remote); }
    catch (cause) {
      if (cause.code === "PAYMENT_PROCESSING") return { received: true, pending: true };
      if (cause.code === "INSUFFICIENT_STOCK" || cause.code === "PAYMENT_CONFIRMATION_PENDING") throw paymentError(503, cause.code, "Payment confirmation requires recovery. Retry this event.");
      throw cause;
    }
    return { received: true };
  }
  return { config, initiate, confirm, reconcile, webhook };
}

module.exports = { createStripePaymentService };
