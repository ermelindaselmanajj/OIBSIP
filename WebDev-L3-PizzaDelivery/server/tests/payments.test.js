const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createPaymentService } = require("../services/payments");
const { configuration, validSignature, createRazorpay } = require("../services/razorpay");
const { pendingOrder } = require("./fixtures/trackingOrders");

const user = "111111111111111111111111";
const signatureSecret = "isolated-provider-signature-fixture";
const sign = (orderId, paymentId) => crypto.createHmac("sha256", signatureSecret).update(`${orderId}|${paymentId}`).digest("hex");
const confirmation = () => ({ razorpay_order_id: "order_fixture", razorpay_payment_id: "pay_fixture", razorpay_signature: sign("order_fixture", "pay_fixture") });
const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
  if (key === "$or") return value.some(part => matches(row, part));
  const actual = row[key];
  if (value && typeof value === "object" && "$gte" in value) return actual >= value.$gte;
  return value === null ? actual == null : String(actual) === String(value);
});
const update = (row, changes) => {
  Object.assign(row, changes.$set);
  for (const key of Object.keys(changes.$unset || {})) delete row[key];
  for (const [key, amount] of Object.entries(changes.$inc || {})) row[key] += amount;
};

function fixture({ ready = true } = {}) {
  const order = pendingOrder({ paymentStatus: "pending", ...(ready ? { providerOrderId: "order_fixture", providerKeyId: "rzp_test_fixture" } : {}) });
  const state = { orders: [order], ingredients: order.items.map(item => ({ _id: item.ingredientId, category: item.category, stock: 8, threshold: 2 })), creates: 0, transactions: 0, failureAt: null };
  const orders = {
    createIndexes: async () => {},
    findOne: query => { const result = () => state.orders.find(row => matches(row, query)) || null; return { session() { return Promise.resolve(result()); }, then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); } }; },
    findOneAndUpdate: async (query, changes) => { const row = state.orders.find(row => matches(row, query)); if (!row) return null; update(row, changes); return row; },
    updateOne: async (query, changes, options) => { const row = state.orders.find(row => matches(row, query)); if (!row) return { modifiedCount: 0 }; if (options?.session && state.failureAt === "order") throw new Error("Simulated database write failure"); update(row, changes); return { modifiedCount: 1 }; },
  };
  let inventoryWrites;
  const inventory = {
    find: async () => state.ingredients,
    updateOne: async (query, changes) => { inventoryWrites++; if (state.failureAt === inventoryWrites) throw new Error("Simulated ingredient write failure"); const row = state.ingredients.find(row => matches(row, query)); if (!row) return { modifiedCount: 0 }; update(row, changes); return { modifiedCount: 1 }; },
  };
  const payment = { id: "pay_fixture", order_id: "order_fixture", amount: 300, currency: "EUR", status: "captured", captured: true, amount_refunded: 0, refund_status: null };
  const remote = { id: "order_fixture", amount: 300, currency: "EUR", receipt: `pizza_${order._id}` };
  const provider = {
    configuration: () => ({ available: true, code: null, message: null }), publicKey: () => "rzp_test_fixture",
    verifySignature: (orderId, id, signature) => validSignature(orderId, id, signature, signatureSecret),
    createOrder: async payload => { state.creates++; assert.deepEqual([payload.amount, payload.currency], [300, "EUR"]); return { ...remote }; },
    getPayment: async () => ({ ...payment }), getOrder: async () => ({ ...remote }),
    listPayments: async () => ({ count: 1, items: [{ ...payment }] }), findOrders: async () => ({ count: 1, items: [{ ...remote }] }),
  };
  let queue = Promise.resolve();
  const startSession = async () => ({
    async withTransaction(operation) {
      const previous = queue; let release; queue = new Promise(resolve => { release = resolve; }); await previous;
      const before = structuredClone({ orders: state.orders, ingredients: state.ingredients });
      state.transactions++; inventoryWrites = 0;
      try { await operation(); } catch (cause) { state.orders = before.orders; state.ingredients = before.ingredients; throw cause; }
      finally { release(); }
    }, async endSession() {},
  });
  const dependencies = { orders, inventory, provider, startSession, transactionsSupported: async () => true };
  const service = createPaymentService(dependencies);
  return { state, provider, service, dependencies, payment, remote, id: order._id };
}

test("payment config refuses absent/live keys and unapproved EUR without exposing values", async () => {
  assert.equal(configuration({}).code, "PAYMENT_KEYS_MISSING");
  assert.equal(configuration({ RAZORPAY_KEY_ID: "rzp_live_fixture", RAZORPAY_KEY_SECRET: "fixture" }).code, "TEST_MODE_REQUIRED");
  assert.equal(configuration({ RAZORPAY_KEY_ID: "rzp_test_fixture", RAZORPAY_KEY_SECRET: "fixture" }).code, "EUR_NOT_ENABLED");
  const f = fixture(); assert.equal((await createPaymentService({ ...f.dependencies, transactionsSupported: async () => false }).config()).code, "TRANSACTIONS_REQUIRED");
});

test("HMAC rejection, ownership, frontend total injection and non-EUR snapshots cannot confirm", async () => {
  const f = fixture();
  for (const body of [{ ...confirmation(), razorpay_signature: "f".repeat(64) }, { ...confirmation(), razorpay_order_id: "order_other" }]) await assert.rejects(f.service.confirm(f.id, user, body), { code: "INVALID_SIGNATURE" });
  await assert.rejects(f.service.confirm(f.id, "222222222222222222222222", confirmation()), { status: 404 });
  await assert.rejects(f.service.confirm(f.id, user, { ...confirmation(), totalMinor: 1 }), { status: 400 });
  f.state.orders[0].currency = "INR";
  await assert.rejects(f.service.initiate(f.id, user), { code: "CURRENCY_UNSUPPORTED" });
  assert.deepEqual(f.state.ingredients.map(row => row.stock), [8, 8, 8]);
});

test("captured status, amount, currency, provider order/payment identity and refunds are verified", async () => {
  for (const patch of [{ amount: 301 }, { currency: "INR" }, { order_id: "order_other" }, { id: "pay_other" }, { status: "authorized", captured: false }, { status: "failed", captured: false }, { captured: false }, { amount_refunded: 1 }, { refund_status: "partial" }]) {
    const f = fixture(); Object.assign(f.payment, patch); await assert.rejects(f.service.confirm(f.id, user, confirmation()));
    assert.equal(f.state.orders[0].paymentStatus, "pending"); assert.deepEqual(f.state.ingredients.map(row => row.stock), [8, 8, 8]);
  }
  const f = fixture(); f.remote.amount++;
  await assert.rejects(f.service.confirm(f.id, user, confirmation()), { code: "PAYMENT_MISMATCH" });
});

test("successful confirmation deducts quantity once and initializes one timestamp under concurrent/repeated callbacks", async () => {
  const f = fixture(); f.state.orders[0].quantity = 2; f.state.orders[0].totalMinor = 600;
  f.state.orders[0].items.forEach(item => { item.quantity = 2; item.lineTotalMinor = 200; }); f.payment.amount = 600; f.remote.amount = 600;
  const values = await Promise.all([f.service.confirm(f.id, user, confirmation()), f.service.confirm(f.id, user, confirmation())]);
  assert.deepEqual(values.map(value => value.order.paymentStatus), ["paid", "paid"]); assert.deepEqual(f.state.ingredients.map(row => row.stock), [6, 6, 6]);
  const first = values[0].order.confirmedAt;
  assert.equal((await f.service.confirm(f.id, user, confirmation())).order.confirmedAt, first);
  assert.equal(f.state.orders[0].fulfillmentHistory.length, 1); assert.equal(f.state.orders[0].fulfillmentStatus, "order_received");
});

test("stock failure and partial-write failures roll back all deduction; capture persists for recovery", async () => {
  for (const failure of [2, "order", "stock"]) {
    const f = fixture(); if (failure === "stock") f.state.ingredients[1].stock = 0; else f.state.failureAt = failure;
    const before = f.state.ingredients.map(row => row.stock);
    await assert.rejects(f.service.confirm(f.id, user, confirmation()), { code: failure === "stock" ? "INSUFFICIENT_STOCK" : "PAYMENT_CONFIRMATION_PENDING" });
    assert.deepEqual(f.state.ingredients.map(row => row.stock), before); assert.equal(f.state.orders[0].status, "pending_payment"); assert.equal(f.state.orders[0].paymentStatus, "review_required"); assert.equal(f.state.orders[0].fulfillmentStatus, undefined);
    await assert.rejects(f.service.initiate(f.id, user), { code: "PAYMENT_REVIEW_REQUIRED" });
    f.state.failureAt = null; f.state.ingredients[1].stock = 8;
    assert.equal((await createPaymentService(f.dependencies).reconcile(f.id, user)).order.status, "confirmed");
    assert.deepEqual(f.state.ingredients.map(row => row.stock), [7, 7, 7]);
  }
});

test("creation CAS prevents duplicate provider orders; failed/cancelled checkout reuses stored order", async () => {
  const f = fixture({ ready: false }); f.provider.listPayments = async () => ({ count: 0, items: [] });
  let release, entered; const gate = new Promise(resolve => { release = resolve; }); const started = new Promise(resolve => { entered = resolve; });
  f.provider.createOrder = async payload => { f.state.creates++; entered(); await gate; return { ...f.remote, receipt: payload.receipt }; };
  const first = f.service.initiate(f.id, user); await started;
  await assert.rejects(f.service.initiate(f.id, user), { code: "PAYMENT_SETUP_IN_PROGRESS" }); release();
  assert.equal((await first).checkout.currency, "EUR");
  f.provider.listPayments = async () => ({ count: 1, items: [{ ...f.payment, status: "failed", captured: false }] });
  assert.equal((await f.service.initiate(f.id, user)).checkout.providerOrderId, "order_fixture"); assert.equal(f.state.creates, 1);
});

test("uncertain creation persists through restart and adopts only one matching receipt", async () => {
  const f = fixture({ ready: false }); f.provider.createOrder = async () => { f.state.creates++; throw new Error("Simulated timeout after provider accepted creation"); };
  await assert.rejects(f.service.initiate(f.id, user), { code: "PAYMENT_SETUP_REVIEW" });
  await assert.rejects(createPaymentService(f.dependencies).initiate(f.id, user), { code: "PAYMENT_SETUP_REVIEW" });
  f.provider.findOrders = async () => ({ count: 0, items: [] });
  await assert.rejects(f.service.reconcile(f.id, user), { code: "PAYMENT_SETUP_REVIEW" });
  assert.equal(f.state.creates, 1);
  f.provider.findOrders = async () => ({ count: 1, items: [{ ...f.remote, currency: "INR" }] });
  await assert.rejects(f.service.reconcile(f.id, user), { code: "PAYMENT_SETUP_REVIEW" });
  f.provider.findOrders = async () => ({ count: 2, items: [{ ...f.remote }] });
  await assert.rejects(f.service.reconcile(f.id, user), { code: "PROVIDER_UNAVAILABLE" });
  f.provider.findOrders = async () => ({ count: 1, items: [{ ...f.remote }] });
  assert.equal((await f.service.reconcile(f.id, user)).order.status, "confirmed"); assert.equal(f.state.creates, 1);
});

test("authorized payments block retries across restart; definitive failure permits reuse", async () => {
  const f = fixture(); f.provider.listPayments = async () => ({ count: 1, items: [{ ...f.payment, status: "authorized", captured: false }] });
  await assert.rejects(f.service.reconcile(f.id, user), { code: "PAYMENT_PROCESSING" }); assert.equal(f.state.orders[0].paymentIssue, "PAYMENT_PROCESSING");
  await assert.rejects(createPaymentService(f.dependencies).initiate(f.id, user), { code: "PAYMENT_PROCESSING" });
  f.provider.listPayments = async () => ({ count: 1, items: [{ ...f.payment, status: "failed", captured: false }] });
  assert.equal((await f.service.reconcile(f.id, user)).order.checkoutEligible, true);
});

test("malformed provider lists, key rotation, multiple captures and zero/corrupt snapshots never charge", async () => {
  for (const payload of [{}, { count: 1, items: [] }, { count: 1, items: [{ ...fixture().payment, status: "unknown" }] }]) {
    const f = fixture(); f.provider.listPayments = async () => payload; await assert.rejects(f.service.initiate(f.id, user), { code: "PROVIDER_UNAVAILABLE" }); assert.equal(f.state.creates, 0);
  }
  const f = fixture(); f.state.orders[0].providerKeyId = "rzp_test_old"; await assert.rejects(f.service.initiate(f.id, user), { code: "PAYMENT_ACCOUNT_CHANGED" });
  const multiple = fixture(); multiple.provider.listPayments = async () => ({ count: 2, items: [multiple.payment, { ...multiple.payment, id: "pay_other" }] });
  await assert.rejects(multiple.service.reconcile(multiple.id, user), { code: "PAYMENT_REVIEW_REQUIRED" }); assert.equal(multiple.state.orders[0].paymentStatus, "review_required");
  for (const patch of [{ totalMinor: 0 }, { totalMinor: Number.MAX_SAFE_INTEGER + 1 }, { quantity: 0 }]) { const invalid = fixture({ ready: false }); Object.assign(invalid.state.orders[0], patch); await assert.rejects(invalid.service.initiate(invalid.id, user), { code: "INVALID_ORDER_SNAPSHOT" }); assert.equal(invalid.state.creates, 0); }
});

test("REST adapter uses authoritative integer EUR request and safe generic failures", async () => {
  const env = { RAZORPAY_KEY_ID: "rzp_test_fixture", RAZORPAY_KEY_SECRET: signatureSecret, RAZORPAY_EUR_ENABLED: "true" };
  const calls = [];
  const provider = createRazorpay({ env, request: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ id: "order_fixture" }) }; } });
  await provider.createOrder({ amount: 750, currency: "EUR" }); assert.equal(JSON.parse(calls[0].options.body).amount, 750); assert.equal(calls[0].url, "https://api.razorpay.com/v1/orders");
  const denied = createRazorpay({ env, request: async () => ({ ok: false, status: 401, json: async () => ({ private: "must not expose" }) }) });
  await assert.rejects(denied.createOrder({}), cause => cause.definitiveRejection && !cause.message.includes("must not expose"));
});
