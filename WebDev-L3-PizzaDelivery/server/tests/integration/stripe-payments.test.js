// Real MongoDB transactions/JWT/HTTP in a uniquely named disposable database.
// All Stripe requests and webhook signatures are isolated test fixtures.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHmac } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const mongoose = require("mongoose");
const express = require("express");
const jwt = require("jsonwebtoken");
const { createStripePaymentService } = require("../../services/stripePayments");
const { createPaymentController } = require("../../controllers/paymentController");
const { supportsTransactions } = require("../../services/payments");
const { verifyWebhook } = require("../../services/stripe");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

test("Stripe with isolated MongoDB transactions, HTTP and simulated provider", { timeout: 180000 }, async t => {
  assert.ok(process.env.MONGO_URI, "Existing MongoDB configuration is required; its value is never logged.");
  const dbName = `pizza_stripe_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const connection = mongoose.createConnection(); let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    try {
      if (connection.readyState === 1) {
        assert.equal(connection.name, dbName); assert.ok(connection.name.startsWith("pizza_stripe_test_"));
        await connection.dropDatabase(); t.diagnostic("Isolated Stripe database dropped. Every Stripe request was simulated.");
      }
    } finally { await connection.close(); }
  });
  try { await connection.openUri(process.env.MONGO_URI, { dbName, serverSelectionTimeoutMS: 10000 }); }
  catch { assert.fail("Could not connect to the isolated database. Check access privately."); }
  assert.equal(connection.name, dbName); assert.equal(await supportsTransactions(connection), true);
  const Order = connection.model("Order", require("../../models/Order").schema);
  const Inventory = connection.model("Inventory", require("../../models/Inventory").schema);
  const User = connection.model("User", require("../../models/User").schema);
  const Admin = connection.model("Admin", require("../../models/Admin").schema);
  await Promise.all([Order.createIndexes(), Inventory.init(), User.init(), Admin.init()]);
  const webhookSecret = "whsec_isolatedintegration", jwtSecret = "isolated-stripe-http-jwt";
  let owner, order, ingredients, tokens, service, sessions = new Map(), creationKeys = new Map(), creates = 0, creationFailure = false;
  const provider = {
    configuration: () => ({ available: true, webhookConfigured: true, code: null, message: null }), accountKey: () => "stripe-isolated-account-fingerprint",
    createSession: async (payload, key) => {
      if (!creationKeys.has(key)) {
        creates++;
        const session = { id: `cs_test_${randomUUID().replace(/-/g, "")}`, mode: "payment", livemode: false, status: "open", payment_status: "unpaid", currency: "eur",
          amount_total: Number(payload["line_items[0][price_data][unit_amount]"]) * Number(payload["line_items[0][quantity]"]), client_reference_id: payload.client_reference_id,
          metadata: { pizzaOrderId: payload["metadata[pizzaOrderId]"], userId: payload["metadata[userId]"] }, payment_intent: null, url: "https://checkout.stripe.com/c/pay/cs_test_isolated" };
        sessions.set(session.id, session); creationKeys.set(key, session);
      }
      if (creationFailure) throw new Error("Isolated response loss after acceptance");
      return structuredClone(creationKeys.get(key));
    },
    getSession: async id => structuredClone(sessions.get(id)),
    verifyWebhook: (raw, signature) => verifyWebhook(raw, signature, webhookSecret),
  };
  const dependencies = { orders: Order, inventory: Inventory, provider, startSession: () => connection.startSession(), transactionsSupported: () => supportsTransactions(connection), clientOrigin: () => "http://localhost:5173" };
  const authModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../middleware/auth.js"), "utf8"), { module: authModule, process: { env: { JWT_SECRET: jwtSecret } }, require(name) { if (name === "jsonwebtoken") return jwt; if (name === "../models/User") return User; if (name === "../models/Admin") return Admin; throw new Error("Unexpected fixture dependency"); } });
  const controllers = createPaymentController({ config: (...args) => service.config(...args), initiate: (...args) => service.initiate(...args), confirm: (...args) => service.confirm(...args), reconcile: (...args) => service.reconcile(...args), webhook: (...args) => service.webhook(...args) });
  const app = express();
  app.post("/api/payments/stripe/webhook", express.raw({ type: "application/json" }), controllers.stripeWebhook);
  app.use(express.json()); app.use("/api/orders", authModule.exports.requireRole("user"));
  app.get("/api/orders/payment-config", controllers.getPaymentConfig);
  app.post("/api/orders/:id/payment", controllers.createPayment);
  app.post("/api/orders/:id/payment/confirm", controllers.confirmPayment);
  app.post("/api/orders/:id/payment/reconcile", controllers.reconcilePayment);
  server = await new Promise((resolve, reject) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); listener.once("error", reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function reset(stock = 4) {
    await Promise.all([Order.deleteMany({}), Inventory.deleteMany({}), User.deleteMany({}), Admin.deleteMany({})]);
    sessions = new Map(); creationKeys = new Map(); creates = 0; creationFailure = false; service = createStripePaymentService(dependencies);
    const users = await User.create([{ name: "Owner", email: "owner@example.test", password: "fixture-hash", isVerified: true }, { name: "Other", email: "other@example.test", password: "fixture-hash", isVerified: true }]); owner = users[0];
    const admin = await Admin.create({ email: "admin@example.test", password: "fixture-hash", isVerified: true });
    tokens = Object.fromEntries([["owner", owner, "user"], ["other", users[1], "user"], ["admin", admin, "admin"]].map(([key, account, role]) => [key, jwt.sign({ role }, jwtSecret, { subject: String(account._id), expiresIn: "1h" })]));
    ingredients = await Inventory.create(["base", "sauce", "cheese"].map(category => ({ name: `Isolated ${category}`, category, stock, threshold: 2, priceMinor: 100, priceCurrency: "EUR" })));
    order = await Order.create({ user: owner._id, status: "pending_payment", paymentStatus: "pending", currency: "EUR", quantity: 2,
      items: ingredients.map(item => ({ ingredientId: item._id, name: item.name, category: item.category, unitPriceMinor: 100, quantity: 2, lineTotalMinor: 200 })), totalMinor: 600, unitTotalMinor: 300,
      idempotencyKey: `fixture_${randomUUID()}`, selectionHash: "a".repeat(64), fulfillmentStatus: null, fulfillmentHistory: [] });
  }
  async function request(suffix = "", role = "owner", payload = {}, method = "POST", id = order._id) {
    const response = await fetch(`${origin}/api/orders${suffix === "/payment-config" ? suffix : `/${id}/payment${suffix}`}`, { method, headers: { "Content-Type": "application/json", ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}) }, body: method === "GET" ? undefined : JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  }
  const stocks = async () => (await Inventory.find().sort({ category: 1 })).map(item => item.stock);
  async function begin(id = order._id) { const result = await request("", "owner", {}, "POST", id); assert.equal(result.status, 200); return sessions.get(result.body.checkout.sessionId); }
  function captured(session, patch = {}) {
    Object.assign(session, { status: "complete", payment_status: "paid", payment_intent: { id: `pi_${randomUUID().replace(/-/g, "")}`, livemode: false, status: "succeeded", amount: session.amount_total, amount_received: session.amount_total, currency: "eur", capture_method: "automatic", metadata: { ...session.metadata } } });
    session.payment_intent.latest_charge = { id: `ch_${randomUUID().replace(/-/g, "")}`, livemode: false, payment_intent: session.payment_intent.id, amount: session.amount_total, currency: "eur", paid: true, captured: true, refunded: false, amount_refunded: 0 };
    Object.assign(session, patch); return session;
  }
  function signed(session, patch = {}) { const raw = JSON.stringify({ id: "evt_isolated", livemode: false, type: "checkout.session.completed", data: { object: session }, ...patch }); const timestamp = Math.floor(Date.now() / 1000); return { raw, signature: `t=${timestamp},v1=${createHmac("sha256", webhookSecret).update(`${timestamp}.${raw}`).digest("hex")}` }; }
  async function webhook(event, mutateBody = value => value) { const response = await fetch(`${origin}/api/payments/stripe/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": event.signature }, body: mutateBody(event.raw) }); return { status: response.status, body: await response.json() }; }

  await t.test("JWT roles/ownership, invalid signatures, raw body tampering and client-total injection", async () => {
    await reset(); const session = await begin(), event = signed(session);
    assert.equal((await request("/payment-config", null, {}, "GET")).status, 401); assert.equal((await request("/payment-config", "admin", {}, "GET")).status, 403);
    assert.equal((await request("/payment-config", "owner", {}, "GET")).body.provider, "stripe");
    for (const suffix of ["", "/confirm", "/reconcile"]) assert.equal((await request(suffix, "other")).status, 404);
    assert.equal((await request("", "owner", { amountMinor: 1 })).status, 400); assert.equal((await request("/confirm", "owner", { sessionId: session.id })).status, 400);
    assert.equal((await webhook({ ...event, signature: "t=1,v1=bad" })).status, 400); assert.equal((await webhook(event, raw => `${raw} `)).status, 400); assert.deepEqual(await stocks(), [4, 4, 4]);
  });
  await t.test("paid status, EUR amount, session/intent/user association and refunds are enforced", async () => {
    const patches = [session => { session.amount_total++; }, session => { session.currency = "inr"; }, session => { session.client_reference_id = "wrong"; }, session => { session.metadata.userId = "wrong"; }, session => { session.livemode = true; }, session => { session.payment_intent.amount_received--; }, session => { session.payment_intent.status = "processing"; }, session => { session.payment_intent.latest_charge.amount_refunded = 1; }, session => { session.payment_intent.latest_charge.refunded = true; }];
    for (const patch of patches) { await reset(); const session = captured(await begin()); patch(session); assert.equal((await request("/reconcile")).status, 409); assert.deepEqual(await stocks(), [4, 4, 4]); assert.equal((await Order.findById(order._id)).paymentStatus, "pending"); }
  });
  await t.test("concurrent signed webhooks and authenticated confirms commit stock exactly once", async () => {
    await reset(2); const session = captured(await begin()), event = signed(session);
    const results = await Promise.all([webhook(event), webhook(event), request("/confirm"), request("/reconcile")]); assert.deepEqual(results.map(result => result.status), [200, 200, 200, 200]); assert.deepEqual(await stocks(), [0, 0, 0]);
    const saved = await Order.findById(order._id); assert.equal(saved.paymentProvider, "stripe"); assert.equal(saved.providerPaymentId, session.payment_intent.id); assert.equal(saved.fulfillmentStatus, "order_received"); assert.equal(saved.fulfillmentHistory.length, 1);
    await Order.updateOne({ _id: order._id }, { $set: { fulfillmentStatus: "in_kitchen" }, $push: { fulfillmentHistory: { status: "in_kitchen", at: new Date() } } }); service = createStripePaymentService(dependencies);
    assert.equal((await webhook(event)).status, 200); assert.equal((await request("/reconcile")).body.order.fulfillmentHistory.length, 2); assert.equal((await request("")).body.checkout, null); assert.equal(creates, 1); assert.deepEqual(await stocks(), [0, 0, 0]);
  });
  await t.test("stock shortage rolls back, captured review blocks repayment and same-payment retry recovers", async () => {
    await reset(); const session = captured(await begin()), event = signed(session); await Inventory.updateOne({ _id: ingredients[1]._id }, { $set: { stock: 1 } }); const before = await stocks();
    assert.equal((await webhook(event)).status, 503); assert.deepEqual(await stocks(), before); const saved = await Order.findById(order._id); assert.equal(saved.paymentStatus, "review_required"); assert.equal(saved.fulfillmentStatus, null); assert.equal(saved.fulfillmentHistory.length, 0); assert.equal((await request("")).status, 409);
    await Inventory.updateOne({ _id: ingredients[1]._id }, { $set: { stock: 4 } }); service = createStripePaymentService(dependencies); assert.equal((await request("/reconcile")).body.order.status, "confirmed"); assert.deepEqual(await stocks(), [2, 2, 2]); assert.equal(creates, 1);
  });
  await t.test("partial inventory and final-order write failures roll back real MongoDB transactions", async () => {
    for (const failing of ["inventory", "order"]) {
      await reset(); captured(await begin()); let writes = 0;
      const injected = failing === "inventory" ? { inventory: { find: (...args) => Inventory.find(...args), updateOne: (...args) => { if (++writes === 2) throw new Error("Isolated stock failure"); return Inventory.updateOne(...args); } } } : { orders: { createIndexes: () => Order.createIndexes(), findOne: (...args) => Order.findOne(...args), findOneAndUpdate: (...args) => Order.findOneAndUpdate(...args), updateOne: (filter, changes, options) => { if (options?.session) throw new Error("Isolated order failure"); return Order.updateOne(filter, changes, options); } } };
      service = createStripePaymentService({ ...dependencies, ...injected }); assert.equal((await request("/confirm")).status, 503); assert.deepEqual(await stocks(), [4, 4, 4]); assert.equal((await Order.findById(order._id)).paymentStatus, "review_required"); service = createStripePaymentService(dependencies); assert.equal((await request("/reconcile")).status, 200); assert.deepEqual(await stocks(), [2, 2, 2]);
    }
  });
  await t.test("two captured orders sharing last stock cannot go negative", async () => {
    await reset(2); const second = await Order.create({ ...order.toObject(), _id: new mongoose.Types.ObjectId(), idempotencyKey: `fixture_${randomUUID()}` }); captured(await begin()); captured(await begin(second._id));
    const results = await Promise.all([request("/confirm"), request("/confirm", "owner", {}, "POST", second._id)]); assert.deepEqual(results.map(result => result.status).sort(), [200, 409]); assert.deepEqual(await stocks(), [0, 0, 0]); assert.equal(await Order.countDocuments({ status: "confirmed" }), 1); assert.equal(await Order.countDocuments({ paymentStatus: "review_required" }), 1);
  });
  await t.test("concurrent initiation/cancellation/refresh reuses one hosted session; expired unpaid retries once", async () => {
    await reset(); const results = await Promise.all([request(""), request("")]); assert.deepEqual(results.map(result => result.status).sort(), [200, 409]); assert.equal(creates, 1);
    const saved = await Order.findById(order._id); assert.equal((await request("")).body.checkout.sessionId, saved.providerOrderId); assert.equal(creates, 1); sessions.get(saved.providerOrderId).status = "expired";
    const retried = await Promise.all([request(""), request("")]); assert.deepEqual(retried.map(result => result.status).sort(), [200, 409]); assert.equal(creates, 2); assert.equal((await Order.findById(order._id)).stripeCheckoutAttempt, 1); assert.deepEqual(await stocks(), [4, 4, 4]);
  });
  await t.test("uncertain creation survives restart and replays persisted payload/idempotency key", async () => {
    await reset(); creationFailure = true; assert.equal((await request("")).status, 503); const saved = await Order.findById(order._id); assert.equal(saved.paymentIssue, "PAYMENT_SETUP_REVIEW"); assert.ok(saved.stripeCreationPayload); assert.equal(creates, 1);
    creationFailure = false; service = createStripePaymentService(dependencies); assert.equal((await request("/reconcile")).status, 200); assert.equal(creates, 1); assert.ok((await Order.findById(order._id)).providerOrderId);
  });
  await t.test("processing blocks another checkout; failed card permits same session retry", async () => {
    await reset(); const session = captured(await begin()); session.status = "open"; session.payment_status = "unpaid"; session.payment_intent.status = "processing";
    assert.equal((await request("/reconcile")).body.code, "PAYMENT_PROCESSING"); service = createStripePaymentService(dependencies); assert.equal((await request("")).status, 409);
    session.payment_intent.status = "requires_payment_method"; session.payment_intent.latest_charge = null; assert.equal((await request("/reconcile")).body.order.paymentIssue, null); assert.equal((await request("")).body.checkout.sessionId, session.id); assert.equal(creates, 1);
  });
  await t.test("legacy Razorpay identity stays unchanged; pending orders without paymentStatus accept Stripe", async () => {
    await reset(); await Order.updateOne({ _id: order._id }, { $set: { providerOrderId: "order_historical", providerKeyId: "rzp_test_historical" } }); const before = await Order.findById(order._id).lean();
    assert.equal((await request("")).body.code, "PAYMENT_PROVIDER_PRESERVED"); assert.deepEqual(await Order.findById(order._id).lean(), before); assert.equal(creates, 0);
    await Order.updateOne({ _id: order._id }, { $unset: { providerOrderId: 1, providerKeyId: 1, paymentStatus: 1 } }); assert.equal((await request("")).status, 200); assert.equal((await Order.findById(order._id)).paymentProvider, "stripe");
  });
  await t.test("signed live/unknown/old-session events cannot mutate orders, snapshots and thresholds stay fixed", async () => {
    await reset(); const session = await begin(), before = await Inventory.find().select("name category stock threshold priceMinor priceCurrency").lean();
    assert.equal((await webhook(signed(session, { livemode: true }))).status, 400); assert.equal((await webhook(signed({ ...session, metadata: { pizzaOrderId: "111111111111111111111111" } }))).body.ignored, true);
    assert.equal((await webhook(signed({ ...session, id: "cs_test_old" }))).body.ignored, true); assert.deepEqual(await Inventory.find().select("name category stock threshold priceMinor priceCurrency").lean(), before); assert.equal((await Order.findById(order._id)).paymentStatus, "pending");
  });
});
