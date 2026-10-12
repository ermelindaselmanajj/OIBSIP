const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { createStripePaymentService } = require("../services/stripePayments");
const { createStripe, configuration, verifyWebhook } = require("../services/stripe");
const { pendingOrder } = require("./fixtures/trackingOrders");

const owner = "111111111111111111111111";
const secret = "whsec_isolatedfixture";
const now = new Date("2026-10-12T10:00:00Z");
const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
  if (key === "$or") return value.some(part => matches(row, part));
  const actual = row[key];
  if (value && typeof value === "object" && "$gte" in value) return actual >= value.$gte;
  if (value && typeof value === "object" && "$ne" in value) return actual !== value.$ne;
  return value === null ? actual == null : String(actual) === String(value);
});
const update = (row, changes) => {
  Object.assign(row, changes.$set);
  for (const key of Object.keys(changes.$unset || {})) delete row[key];
  for (const [key, amount] of Object.entries(changes.$inc || {})) row[key] = (row[key] || 0) + amount;
};

function fixture({ ready = true } = {}) {
  const order = pendingOrder({ paymentStatus: "pending", ...(ready ? { paymentProvider: "stripe", providerOrderId: "cs_test_fixture", providerKeyId: "fixture-key-fingerprint", stripeCheckoutAttempt: 0 } : {}) });
  const state = { orders: [order], ingredients: order.items.map(item => ({ _id: item.ingredientId, category: item.category, stock: 8, threshold: 2 })), creates: 0, uniqueCreates: 0, failureAt: null };
  const orders = {
    createIndexes: async () => {},
    findOne: query => { const result = () => state.orders.find(row => matches(row, query)) || null; return { session() { return Promise.resolve(result()); }, then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); } }; },
    findOneAndUpdate: async (query, changes) => { const row = state.orders.find(row => matches(row, query)); if (!row) return null; update(row, changes); return row; },
    updateOne: async (query, changes, options) => { const row = state.orders.find(row => matches(row, query)); if (!row) return { modifiedCount: 0 }; if (options?.session && state.failureAt === "order") throw new Error("Isolated order failure"); update(row, changes); return { modifiedCount: 1 }; },
  };
  let writes = 0;
  const inventory = { find: async () => state.ingredients, updateOne: async (query, changes) => { if (++writes === state.failureAt) throw new Error("Isolated stock failure"); const row = state.ingredients.find(row => matches(row, query)); if (!row) return { modifiedCount: 0 }; update(row, changes); return { modifiedCount: 1 }; } };
  const intent = { id: "pi_fixture", livemode: false, amount: 300, amount_received: 300, currency: "eur", status: "succeeded", capture_method: "automatic", metadata: { pizzaOrderId: order._id, userId: owner }, latest_charge: { id: "ch_fixture", livemode: false, amount: 300, currency: "eur", payment_intent: "pi_fixture", paid: true, captured: true, refunded: false, amount_refunded: 0 } };
  const session = { id: "cs_test_fixture", livemode: false, mode: "payment", status: "open", payment_status: "unpaid", amount_total: 300, currency: "eur", client_reference_id: order._id, metadata: { pizzaOrderId: order._id, userId: owner }, payment_intent: null, url: "https://checkout.stripe.com/c/pay/cs_test_fixture" };
  const seenKeys = new Map();
  const provider = {
    configuration: () => ({ available: true, webhookConfigured: true, code: null, message: null }), accountKey: () => "fixture-key-fingerprint",
    createSession: async (payload, key) => { state.creates++; assert.deepEqual([payload["line_items[0][price_data][currency]"], payload["line_items[0][price_data][unit_amount]"], payload["line_items[0][quantity]"]], ["eur", "300", "1"]); if (!seenKeys.has(key)) { state.uniqueCreates++; seenKeys.set(key, { ...session, id: `cs_test_fixture${state.uniqueCreates}` }); } Object.assign(session, seenKeys.get(key)); return structuredClone(session); },
    getSession: async () => structuredClone(session), verifyWebhook: (raw, signature) => verifyWebhook(raw, signature, secret, now.getTime()),
  };
  let queue = Promise.resolve();
  const startSession = async () => ({ async withTransaction(operation) { const previous = queue; let release; queue = new Promise(resolve => { release = resolve; }); await previous; const before = structuredClone({ orders: state.orders, ingredients: state.ingredients }); writes = 0; try { await operation(); } catch (cause) { state.orders = before.orders; state.ingredients = before.ingredients; throw cause; } finally { release(); } }, async endSession() {} });
  const dependencies = { orders, inventory, provider, startSession, transactionsSupported: async () => true, clientOrigin: () => "http://localhost:5173", now: () => now };
  const service = createStripePaymentService(dependencies);
  const pay = () => { session.status = "complete"; session.payment_status = "paid"; session.payment_intent = intent; };
  const event = (patch = {}) => { const raw = Buffer.from(JSON.stringify({ id: "evt_fixture", livemode: false, type: "checkout.session.completed", data: { object: { ...session } }, ...patch })); const timestamp = Math.floor(now.getTime() / 1000); return { raw, signature: `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest("hex")}` }; };
  return { service, dependencies, state, provider, session, intent, pay, event, id: order._id };
}

test("Stripe config rejects missing/live/restricted keys, fingerprints secrets and requires transactions", async () => {
  assert.equal(configuration({}).code, "PAYMENT_KEYS_MISSING");
  for (const key of ["sk_live_fixture", "rk_test_fixture", "pk_test_fixture"]) assert.equal(configuration({ STRIPE_SECRET_KEY: key }).code, "TEST_MODE_REQUIRED");
  const adapter = createStripe({ env: { STRIPE_SECRET_KEY: "sk_test_fixture" } }); assert.match(adapter.accountKey(), /^[a-f\d]{64}$/); assert.equal(adapter.configuration().webhookConfigured, false);
  const f = fixture(); assert.equal((await createStripePaymentService({ ...f.dependencies, transactionsSupported: async () => false }).config()).code, "TRANSACTIONS_REQUIRED");
  assert.equal((await f.service.config()).provider, "stripe");
});

test("signed webhook verifies raw bytes, multiple signatures, tolerance, JSON and test mode", () => {
  const f = fixture(); const event = f.event();
  assert.equal(verifyWebhook(event.raw, `${event.signature},v1=${"f".repeat(64)}`, secret, now.getTime()).id, "evt_fixture");
  for (const [body, signature, time] of [[event.raw, event.signature, now.getTime() + 301000], [Buffer.from(`${event.raw} `), event.signature, now.getTime()], [event.raw.toString(), event.signature, now.getTime()], [event.raw, "t=bad,v1=bad", now.getTime()], [event.raw, `${event.signature},t=1`, now.getTime()]]) assert.throws(() => verifyWebhook(body, signature, secret, time), { code: "INVALID_WEBHOOK_SIGNATURE" });
  const live = f.event({ livemode: true }); assert.throws(() => verifyWebhook(live.raw, live.signature, secret, now.getTime()), { code: "INVALID_WEBHOOK" });
  assert.throws(() => createStripe({ env: {} }).verifyWebhook(event.raw, event.signature), { code: "WEBHOOK_UNAVAILABLE" });
});

test("ownership, client payload, legacy provider and invalid snapshots never initiate Stripe", async () => {
  const f = fixture(); await assert.rejects(f.service.initiate(f.id, "222222222222222222222222"), { status: 404 }); await assert.rejects(f.service.confirm(f.id, owner, { amountMinor: 1 }), { status: 400 });
  f.state.orders[0].paymentProvider = "razorpay"; f.state.orders[0].providerOrderId = "order_old";
  await assert.rejects(f.service.initiate(f.id, owner), { code: "PAYMENT_PROVIDER_PRESERVED" });
  let legacyCalls = 0; const legacy = { reconcile: async () => { legacyCalls++; return { original: true }; }, confirm: async () => { legacyCalls++; return { original: true }; } };
  const mixed = createStripePaymentService({ ...f.dependencies, legacy }); assert.deepEqual(await mixed.reconcile(f.id, owner), { original: true }); assert.deepEqual(await mixed.confirm(f.id, owner, {}), { original: true }); assert.equal(legacyCalls, 2); assert.equal(f.state.creates, 0);
  const invalid = fixture({ ready: false }); invalid.state.orders[0].currency = "INR"; await assert.rejects(invalid.service.initiate(invalid.id, owner), { code: "CURRENCY_UNSUPPORTED" });
});

test("session and intent amount, currency, association, captured status and refunds are verified", async () => {
  const patches = [f => { f.session.amount_total++; }, f => { f.session.currency = "inr"; }, f => { f.session.client_reference_id = "wrong"; }, f => { f.session.metadata.userId = "wrong"; }, f => { f.session.livemode = true; }, f => { f.session.id = "cs_test_other"; }, f => { f.intent.amount_received--; }, f => { f.intent.currency = "inr"; }, f => { f.intent.status = "processing"; }, f => { f.intent.livemode = true; }, f => { f.intent.metadata.pizzaOrderId = "wrong"; }, f => { f.intent.latest_charge.captured = false; }, f => { f.intent.latest_charge.amount_refunded = 1; }, f => { f.intent.latest_charge.refunded = true; }, f => { f.intent.latest_charge.payment_intent = "pi_other"; }];
  for (const patch of patches) { const f = fixture(); f.pay(); patch(f); await assert.rejects(f.service.reconcile(f.id, owner)); assert.equal(f.state.orders[0].paymentStatus, "pending"); assert.deepEqual(f.state.ingredients.map(item => item.stock), [8, 8, 8]); }
});

test("concurrent fallback and signed callbacks deduct quantity once and preserve later fulfillment", async () => {
  const f = fixture(); f.pay(); const event = f.event();
  await Promise.all([f.service.reconcile(f.id, owner), f.service.confirm(f.id, owner, {}), f.service.webhook(event.raw, event.signature)]);
  assert.deepEqual(f.state.ingredients.map(item => item.stock), [7, 7, 7]); assert.equal(f.state.orders[0].fulfillmentHistory.length, 1);
  f.state.orders[0].fulfillmentStatus = "in_kitchen"; f.state.orders[0].fulfillmentHistory.push({ status: "in_kitchen", at: now });
  await createStripePaymentService(f.dependencies).webhook(event.raw, event.signature); assert.equal(f.state.orders[0].fulfillmentHistory.length, 2); assert.equal(f.state.orders[0].fulfillmentStatus, "in_kitchen"); assert.deepEqual(f.state.ingredients.map(item => item.stock), [7, 7, 7]);
  assert.equal((await f.service.initiate(f.id, owner)).checkout, null);
});

test("insufficient stock and partial failures roll back and prohibit another charge", async () => {
  for (const failure of [2, "order", "stock"]) {
    const f = fixture(); f.pay(); if (failure === "stock") f.state.ingredients[1].stock = 0; else f.state.failureAt = failure;
    const before = f.state.ingredients.map(item => item.stock), event = f.event();
    await assert.rejects(f.service.webhook(event.raw, event.signature), { status: 503 }); assert.deepEqual(f.state.ingredients.map(item => item.stock), before);
    assert.equal(f.state.orders[0].paymentStatus, "review_required"); assert.equal(f.state.orders[0].status, "pending_payment"); await assert.rejects(f.service.initiate(f.id, owner), { code: "PAYMENT_REVIEW_REQUIRED" });
    f.state.failureAt = null; f.state.ingredients[1].stock = 8; assert.equal((await createStripePaymentService(f.dependencies).reconcile(f.id, owner)).order.status, "confirmed"); assert.deepEqual(f.state.ingredients.map(item => item.stock), [7, 7, 7]);
  }
});

test("cancellation/retry resumes one session; expired unpaid session permits exactly one new attempt", async () => {
  const f = fixture({ ready: false }); const first = await f.service.initiate(f.id, owner); assert.equal(first.checkout.provider, "stripe");
  assert.equal((await f.service.initiate(f.id, owner)).checkout.sessionId, first.checkout.sessionId); assert.equal(f.state.uniqueCreates, 1);
  f.session.status = "expired"; f.session.url = null;
  const originalCreate = f.provider.createSession;
  f.provider.createSession = async (...args) => { f.session.status = "open"; f.session.url = "https://checkout.stripe.com/c/pay/cs_test_fixture"; return originalCreate(...args); };
  const retried = await f.service.initiate(f.id, owner); assert.notEqual(retried.checkout.sessionId, first.checkout.sessionId); assert.equal(f.state.uniqueCreates, 2); assert.equal(f.state.orders[0].stripeCheckoutAttempt, 1);
});

test("durable idempotency recovers uncertain creation after restart and refuses unsafe old retries", async () => {
  const f = fixture({ ready: false }), original = f.provider.createSession; let failure = true;
  f.provider.createSession = async (...args) => { const result = await original(...args); if (failure) throw new Error("Network response lost"); return result; };
  await assert.rejects(f.service.initiate(f.id, owner)); assert.equal(f.state.orders[0].paymentIssue, "PAYMENT_SETUP_REVIEW"); failure = false;
  const recovered = await createStripePaymentService(f.dependencies).reconcile(f.id, owner); assert.equal(recovered.order.paymentProvider, "stripe"); assert.equal(f.state.uniqueCreates, 1); assert.equal(f.state.creates, 2);
  delete f.state.orders[0].providerOrderId; f.state.orders[0].paymentIssue = "PAYMENT_SETUP_REVIEW"; f.state.orders[0].paymentCreationStartedAt = new Date(now - 24 * 60 * 60 * 1000);
  await assert.rejects(f.service.reconcile(f.id, owner), { code: "PAYMENT_SETUP_REVIEW" }); assert.equal(f.state.creates, 2);
});

test("processing/capture uncertainty, bad hosted URLs and changed keys prevent unsafe checkout", async () => {
  const f = fixture(); f.session.payment_intent = { ...f.intent, status: "processing" }; await assert.rejects(f.service.initiate(f.id, owner), { code: "PAYMENT_PROCESSING" }); assert.equal(f.state.creates, 0);
  f.session.payment_intent.status = "requires_payment_method"; await f.service.reconcile(f.id, owner); assert.equal(f.state.orders[0].paymentIssue, undefined);
  f.session.url = "https://attacker.example.test"; await assert.rejects(f.service.initiate(f.id, owner), { code: "PROVIDER_UNAVAILABLE" });
  f.state.orders[0].providerKeyId = "old-key-fingerprint"; await assert.rejects(f.service.reconcile(f.id, owner), { code: "PAYMENT_ACCOUNT_CHANGED" });
});

test("unknown/old-session events are ignored, raw signed event alone is never payment proof", async () => {
  const f = fixture(); const signedPaid = f.event({ data: { object: { ...f.session, payment_status: "paid" } } });
  await f.service.webhook(signedPaid.raw, signedPaid.signature); assert.equal(f.state.orders[0].paymentStatus, "pending"); assert.deepEqual(f.state.ingredients.map(item => item.stock), [8, 8, 8]);
  const unknown = f.event({ data: { object: { ...f.session, metadata: { pizzaOrderId: "222222222222222222222222" } } } }); assert.equal((await f.service.webhook(unknown.raw, unknown.signature)).ignored, true);
  const old = f.event({ data: { object: { ...f.session, id: "cs_test_old" } } }); assert.equal((await f.service.webhook(old.raw, old.signature)).ignored, true);
});

test("REST adapter sends server EUR form and stable idempotency header; failures hide private details", async () => {
  const calls = [], env = { STRIPE_SECRET_KEY: "sk_test_fixture" };
  const adapter = createStripe({ env, request: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ id: "cs_test_fixture" }) }; } });
  await adapter.createSession({ "line_items[0][price_data][currency]": "eur", "line_items[0][price_data][unit_amount]": "350" }, "fixture-idempotency");
  assert.equal(calls[0].options.headers["Idempotency-Key"], "fixture-idempotency"); assert.equal(new URLSearchParams(calls[0].options.body).get("line_items[0][price_data][unit_amount]"), "350");
  await adapter.getSession("cs_test_fixture"); assert.ok(calls[1].url.includes("expand[]=payment_intent.latest_charge"));
  const denied = createStripe({ env, request: async () => ({ ok: false, status: 401, json: async () => ({ message: "private-key-must-not-appear" }) }) });
  await assert.rejects(denied.createSession({}, "fixture"), cause => !cause.message.includes("private-key"));
});
