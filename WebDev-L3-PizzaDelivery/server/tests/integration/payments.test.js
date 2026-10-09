// Explicit opt-in only: isolated MongoDB, real transactions/HTTP/JWT, simulated
// Razorpay. No server startup, SMTP calls or production database writes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHmac } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const mongoose = require("mongoose");
const express = require("express");
const jwt = require("jsonwebtoken");
const { createPaymentService, supportsTransactions } = require("../../services/payments");
const { createPaymentController } = require("../../controllers/paymentController");
const { validSignature } = require("../../services/razorpay");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

test("payments with isolated MongoDB transactions and simulated Razorpay", { timeout: 120000 }, async t => {
  assert.ok(process.env.MONGO_URI, "An existing MongoDB configuration is required; its value is never logged.");
  const dbName = `pizza_pay_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const connection = mongoose.createConnection(); let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    try {
      if (connection.readyState === 1) {
        assert.equal(connection.name, dbName); assert.ok(connection.name.startsWith("pizza_pay_test_"));
        await connection.dropDatabase(); t.diagnostic("Isolated payments database dropped. Every provider call was simulated.");
      }
    } finally { await connection.close(); }
  });
  try { await connection.openUri(process.env.MONGO_URI, { dbName, serverSelectionTimeoutMS: 10000 }); }
  catch { assert.fail("Could not connect to the isolated database. Check network and MongoDB access privately."); }
  assert.equal(connection.name, dbName); assert.equal(await supportsTransactions(connection), true);
  const Order = connection.model("Order", require("../../models/Order").schema);
  const Inventory = connection.model("Inventory", require("../../models/Inventory").schema);
  const User = connection.model("User", require("../../models/User").schema);
  const Admin = connection.model("Admin", require("../../models/Admin").schema);
  await Promise.all([Order.createIndexes(), Inventory.init(), User.init(), Admin.init()]);
  const signatureSecret = "isolated-razorpay-provider-secret";
  const jwtSecret = "isolated-payments-http-jwt";
  let owner, other, admin, order, ingredients, payments = new Map(), remoteOrders = new Map(), providerCreates = 0;
  const provider = {
    configuration: () => ({ available: true, code: null, message: null }), publicKey: () => "rzp_test_isolated",
    verifySignature: (id, paymentId, signature) => validSignature(id, paymentId, signature, signatureSecret),
    createOrder: async payload => { providerCreates++; const result = { id: `order_${randomUUID().replace(/-/g, "")}`, ...payload }; remoteOrders.set(result.id, result); return result; },
    getOrder: async id => remoteOrders.get(id), getPayment: async id => payments.get(id),
    listPayments: async id => { const items = [...payments.values()].filter(payment => payment.order_id === id); return { count: items.length, items }; },
    findOrders: async receipt => { const items = [...remoteOrders.values()].filter(value => value.receipt === receipt); return { count: items.length, items }; },
  };
  const dependencies = { orders: Order, inventory: Inventory, provider, startSession: () => connection.startSession(), transactionsSupported: () => supportsTransactions(connection) };
  let service = createPaymentService(dependencies);
  const authModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../middleware/auth.js"), "utf8"), {
    module: authModule, process: { env: { JWT_SECRET: jwtSecret } }, require(name) {
      if (name === "jsonwebtoken") return jwt;
      if (name === "../models/User") return User;
      if (name === "../models/Admin") return Admin;
      throw new Error("Unexpected fixture dependency");
    },
  });
  const controllers = createPaymentController({ config: (...args) => service.config(...args), initiate: (...args) => service.initiate(...args), confirm: (...args) => service.confirm(...args), reconcile: (...args) => service.reconcile(...args) });
  const app = express(); app.use(express.json()); app.use(authModule.exports.requireRole("user"));
  app.get("/api/orders/payment-config", controllers.getPaymentConfig);
  app.post("/api/orders/:id/payment", controllers.createPayment);
  app.post("/api/orders/:id/payment/confirm", controllers.confirmPayment);
  app.post("/api/orders/:id/payment/reconcile", controllers.reconcilePayment);
  server = await new Promise((resolve, reject) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); listener.once("error", reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let tokens;
  async function reset(stock = 4, ready = true) {
    await Promise.all([Order.deleteMany({}), Inventory.deleteMany({}), User.deleteMany({}), Admin.deleteMany({})]);
    payments = new Map(); remoteOrders = new Map(); providerCreates = 0; service = createPaymentService(dependencies);
    [owner, other] = await User.create([{ name: "Owner", email: "owner@example.test", password: "fixture-hash", isVerified: true }, { name: "Other", email: "other@example.test", password: "fixture-hash", isVerified: true }]);
    admin = await Admin.create({ email: "admin@example.test", password: "fixture-hash", isVerified: true });
    tokens = Object.fromEntries([["owner", owner, "user"], ["other", other, "user"], ["admin", admin, "admin"]].map(([key, identity, role]) => [key, jwt.sign({ role }, jwtSecret, { subject: String(identity._id), expiresIn: "1h" })]));
    ingredients = await Inventory.create(["base", "sauce", "cheese"].map(category => ({ name: `Fixture ${category}`, category, stock, threshold: 2, priceMinor: 100, priceCurrency: "EUR" })));
    order = await Order.create({ user: owner._id, status: "pending_payment", paymentStatus: "pending", currency: "EUR", quantity: 2,
      items: ingredients.map(item => ({ ingredientId: item._id, name: item.name, category: item.category, unitPriceMinor: 100, quantity: 2, lineTotalMinor: 200 })),
      totalMinor: 600, unitTotalMinor: 300, idempotencyKey: `fixture_${randomUUID()}`, selectionHash: "a".repeat(64), fulfillmentStatus: null, fulfillmentHistory: [],
      ...(ready ? { providerOrderId: "order_fixture", providerKeyId: "rzp_test_isolated" } : {}),
    });
    remoteOrders.set("order_fixture", { id: "order_fixture", amount: 600, currency: "EUR", receipt: `pizza_${order._id}` });
  }
  const captured = (id = "pay_fixture", providerOrderId = "order_fixture", patch = {}) => {
    const payment = { id, order_id: providerOrderId, amount: 600, currency: "EUR", captured: true, status: "captured", amount_refunded: 0, refund_status: null, ...patch };
    payments.set(id, payment); return payment;
  };
  const body = (id = "pay_fixture", providerOrderId = "order_fixture") => ({ razorpay_order_id: providerOrderId, razorpay_payment_id: id, razorpay_signature: createHmac("sha256", signatureSecret).update(`${providerOrderId}|${id}`).digest("hex") });
  async function request(endpoint, role = "owner", payload = {}, method = "POST") {
    const headers = { "Content-Type": "application/json" }; if (role) headers.Authorization = `Bearer ${tokens[role]}`;
    const response = await fetch(`${origin}/api/orders${endpoint}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  }
  const endpoint = suffix => `/${order._id}/payment${suffix}`;
  const stocks = async () => (await Inventory.find().sort({ category: 1 })).map(row => row.stock);

  await t.test("real JWT permissions, ownership and request injection", async () => {
    await reset(); captured();
    assert.equal((await request("/payment-config", null, {}, "GET")).status, 401);
    assert.equal((await request("/payment-config", "admin", {}, "GET")).status, 403);
    assert.equal((await request("/payment-config", "owner", {}, "GET")).body.available, true);
    for (const suffix of ["", "/confirm", "/reconcile"]) assert.equal((await request(endpoint(suffix), "other", suffix === "/confirm" ? body() : {})).status, 404);
    assert.equal((await request(endpoint(""), "owner", { totalMinor: 1 })).status, 400);
    assert.equal((await request(endpoint("/confirm"), "owner", { ...body(), razorpay_signature: "f".repeat(64) })).status, 400);
    assert.deepEqual(await stocks(), [4, 4, 4]);
  });
  await t.test("captured payment amount/currency/order mismatch, failure and refunds preserve pending inventory", async () => {
    for (const patch of [{ amount: 601 }, { currency: "INR" }, { order_id: "order_wrong" }, { status: "failed", captured: false }, { amount_refunded: 100, refund_status: "partial" }]) {
      await reset(); captured("pay_fixture", "order_fixture", patch);
      assert.equal((await request(endpoint("/confirm"), "owner", body())).status, 409);
      assert.deepEqual(await stocks(), [4, 4, 4]); assert.equal((await Order.findById(order._id)).paymentStatus, "pending");
    }
  });
  await t.test("concurrent callbacks and repeat/restart deduct exactly quantity once at stock boundary", async () => {
    await reset(2); captured();
    const results = await Promise.all(Array.from({ length: 4 }, () => request(endpoint("/confirm"), "owner", body())));
    assert.deepEqual(results.map(value => value.status), [200, 200, 200, 200]); assert.deepEqual(await stocks(), [0, 0, 0]);
    const saved = await Order.findById(order._id).lean(); assert.equal(saved.fulfillmentHistory.length, 1); assert.equal(saved.fulfillmentStatus, "order_received"); assert.ok(saved.stockDeductedAt);
    service = createPaymentService(dependencies);
    const repeated = await request(endpoint("/confirm"), "owner", body()); assert.equal(repeated.status, 200); assert.equal(repeated.body.order.confirmedAt, saved.confirmedAt.toISOString());
    assert.equal((await request(endpoint("/reconcile"))).status, 200); assert.deepEqual(await stocks(), [0, 0, 0]);
  });
  await t.test("insufficient second ingredient rolls back first decrement; legitimate restock permits same-payment recovery", async () => {
    await reset(); captured(); await Inventory.updateOne({ _id: ingredients[1]._id }, { $set: { stock: 1 } });
    const before = await stocks(); const result = await request(endpoint("/confirm"), "owner", body());
    assert.equal(result.status, 409); assert.equal(result.body.code, "INSUFFICIENT_STOCK"); assert.deepEqual(await stocks(), before);
    const saved = await Order.findById(order._id); assert.equal(saved.paymentStatus, "review_required"); assert.equal(saved.status, "pending_payment"); assert.equal(saved.fulfillmentStatus, null); assert.equal(saved.fulfillmentHistory.length, 0);
    assert.equal((await request(endpoint(""))).status, 409);
    await Inventory.updateOne({ _id: ingredients[1]._id }, { $set: { stock: 4 } }); service = createPaymentService(dependencies);
    assert.equal((await request(endpoint("/reconcile"))).body.order.status, "confirmed"); assert.deepEqual(await stocks(), [2, 2, 2]);
  });
  await t.test("multiple vegetables deduct pizza quantity; duplicate callbacks preserve later kitchen stage/history", async () => {
    await reset();
    const vegetables = await Inventory.create(["Pepper", "Mushroom"].map(name => ({ name, category: "vegetable", stock: 4, threshold: 2, priceCurrency: "EUR", priceMinor: 100 })));
    order.items.push(...vegetables.map(item => ({ ingredientId: item._id, name: item.name, category: item.category, unitPriceMinor: 100, quantity: 2, lineTotalMinor: 200 })));
    order.unitTotalMinor = 500; order.totalMinor = 1000; await order.save();
    remoteOrders.get("order_fixture").amount = 1000; captured("pay_fixture", "order_fixture", { amount: 1000 });
    assert.equal((await request(endpoint("/confirm"), "owner", body())).status, 200); assert.deepEqual(await stocks(), [2, 2, 2, 2, 2]);
    const at = new Date(); await Order.updateOne({ _id: order._id, status: "confirmed", fulfillmentStatus: "order_received" }, { $set: { fulfillmentStatus: "in_kitchen" }, $push: { fulfillmentHistory: { status: "in_kitchen", at } } });
    const later = await request(endpoint("/confirm"), "owner", body()); assert.equal(later.status, 200); assert.equal(later.body.order.fulfillmentStatus, "in_kitchen"); assert.equal(later.body.order.fulfillmentHistory.length, 2); assert.equal(later.body.order.fulfillmentHistory[1].at, at.toISOString()); assert.deepEqual(await stocks(), [2, 2, 2, 2, 2]);
  });
  await t.test("database failure after first ingredient write rolls back and remains recoverable", async () => {
    await reset(); captured(); let writes = 0;
    service = createPaymentService({ ...dependencies, inventory: { find: (...args) => Inventory.find(...args), updateOne: (...args) => { if (++writes === 2) throw new Error("Isolated write failure"); return Inventory.updateOne(...args); } } });
    const result = await request(endpoint("/confirm"), "owner", body()); assert.equal(result.status, 503); assert.equal(result.body.order.paymentStatus, "review_required"); assert.deepEqual(await stocks(), [4, 4, 4]);
    service = createPaymentService(dependencies); assert.equal((await request(endpoint("/reconcile"))).body.order.paymentStatus, "paid"); assert.deepEqual(await stocks(), [2, 2, 2]);
  });
  await t.test("final order write failure rolls back every ingredient decrement", async () => {
    await reset(); captured();
    service = createPaymentService({ ...dependencies, orders: { createIndexes: () => Order.createIndexes(), findOne: (...args) => Order.findOne(...args), findOneAndUpdate: (...args) => Order.findOneAndUpdate(...args), updateOne: (filter, changes, options) => { if (options?.session) throw new Error("Isolated order update failure"); return Order.updateOne(filter, changes, options); } } });
    assert.equal((await request(endpoint("/confirm"), "owner", body())).status, 503); assert.deepEqual(await stocks(), [4, 4, 4]);
    assert.equal((await Order.findById(order._id)).status, "pending_payment");
  });
  await t.test("two competing captured orders cannot make shared stock negative", async () => {
    await reset(2); captured();
    const second = await Order.create({ ...order.toObject(), _id: new mongoose.Types.ObjectId(), idempotencyKey: `fixture_${randomUUID()}`, providerOrderId: "order_second" });
    remoteOrders.set("order_second", { id: "order_second", amount: 600, currency: "EUR" }); captured("pay_second", "order_second");
    const results = await Promise.all([request(endpoint("/confirm"), "owner", body()), request(`/${second._id}/payment/confirm`, "owner", body("pay_second", "order_second"))]);
    assert.deepEqual(results.map(value => value.status).sort(), [200, 409]); assert.deepEqual(await stocks(), [0, 0, 0]); assert.equal(await Order.countDocuments({ status: "confirmed" }), 1); assert.equal(await Order.countDocuments({ paymentStatus: "review_required" }), 1);
  });
  await t.test("provider creation CAS, cancellation and failure reuse a single persisted provider order", async () => {
    await reset(4, false);
    const results = await Promise.all([request(endpoint("")), request(endpoint(""))]); assert.deepEqual(results.map(value => value.status).sort(), [200, 409]); assert.equal(providerCreates, 1);
    const saved = await Order.findById(order._id); const paymentId = saved.providerOrderId;
    assert.equal((await request(endpoint(""))).body.checkout.providerOrderId, paymentId); assert.equal(providerCreates, 1);
    captured("pay_failed", paymentId, { status: "failed", captured: false }); service = createPaymentService(dependencies);
    assert.equal((await request(endpoint("/reconcile"))).body.order.checkoutEligible, true); assert.equal((await request(endpoint(""))).body.checkout.providerOrderId, paymentId); assert.equal(providerCreates, 1);
  });
  await t.test("stored authorized state blocks repeat checkout until capture and preserves prices/thresholds", async () => {
    await reset(); const before = await Inventory.find().select("name category threshold priceMinor priceCurrency").lean();
    captured("pay_fixture", "order_fixture", { status: "authorized", captured: false });
    assert.equal((await request(endpoint("/reconcile"))).body.order.paymentIssue, "PAYMENT_PROCESSING"); service = createPaymentService(dependencies);
    assert.equal((await request(endpoint(""))).status, 409);
    captured(); assert.equal((await request(endpoint("/reconcile"))).body.order.status, "confirmed");
    assert.deepEqual(await Inventory.find().select("name category threshold priceMinor priceCurrency").lean(), before);
  });
});
