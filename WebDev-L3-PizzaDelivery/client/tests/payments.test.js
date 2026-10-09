import test from "node:test";
import assert from "node:assert/strict";
import { checkoutOptions, checkoutScript, loadRazorpay, parsePaymentConfig, parsePaymentSession, paymentCallback, paymentError } from "../src/components/orders/payment.js";
import { parseOrder } from "../src/components/orders/orderHelpers.js";
import { nextAction, paymentLabel } from "../src/components/orders/tracking.js";

const timestamp = "2026-10-09T10:00:00.000Z";
function order(overrides = {}) {
  return { id: "saved-order", currency: "EUR", quantity: 2,
    items: ["base", "sauce", "cheese"].map((category) => ({ ingredientId: category, category, name: category, unitPriceMinor: 100, quantity: 2, lineTotalMinor: 200 })),
    unitTotalMinor: 300, totalMinor: 600, status: "pending_payment", paymentStatus: "pending", paymentIssue: null,
    createdAt: timestamp, updatedAt: timestamp, fulfillmentStatus: null, fulfillmentHistory: [], confirmedAt: null, nextFulfillmentStatus: null,
    checkoutEligible: true, ...overrides };
}
const checkout = () => ({ keyId: "rzp_test_abcdef123", providerOrderId: "order_abcdef123", amountMinor: 600, currency: "EUR", name: "Pizza Delivery", description: "Pizza order" });

test("payment availability explicitly stays in EUR test mode and missing keys remain unavailable", () => {
  const unavailable = { available: false, mode: "test", currency: "EUR", code: "PAYMENT_UNAVAILABLE", message: "Test payments unavailable." };
  assert.equal(parsePaymentConfig(unavailable).available, false);
  assert.equal(parsePaymentConfig({ ...unavailable, available: true, code: null, message: null }).available, true);
  for (const invalid of [{}, { ...unavailable, available: "true" }, { ...unavailable, mode: "live" }, { ...unavailable, currency: "INR" }]) assert.throws(() => parsePaymentConfig(invalid));
});

test("checkout requires matching server amount, currency, owned order and public test key", () => {
  const session = { order: order(), checkout: checkout() };
  assert.equal(parsePaymentSession(session, order()).checkout.amountMinor, 600);
  for (const invalid of [
    { ...checkout(), keyId: "rzp_live_abc" }, { ...checkout(), currency: "INR" },
    { ...checkout(), amountMinor: 601 }, { ...checkout(), providerOrderId: "wrong" }, { ...checkout(), amountMinor: "600" },
  ]) assert.throws(() => parsePaymentSession({ ...session, checkout: invalid }, order()));
  assert.throws(() => parsePaymentSession({ ...session, order: order({ id: "someone-else" }) }, order()));
  assert.throws(() => parsePaymentSession({ ...session, checkout: null }, order()));
  assert.throws(() => parsePaymentSession({ ...session, order: order({ paymentIssue: "PAYMENT_SETUP_REVIEW", checkoutEligible: false }) }, order()));
});

test("only authoritative confirmed order permits recovered checkout without a provider modal", () => {
  const confirmed = order({ status: "confirmed", paymentStatus: "paid", checkoutEligible: false, fulfillmentStatus: "order_received", confirmedAt: timestamp, fulfillmentHistory: [{ status: "order_received", at: timestamp }], nextFulfillmentStatus: "in_kitchen" });
  assert.equal(parsePaymentSession({ order: confirmed, checkout: null }, order()).order, confirmed);
});

test("captured stock review and unresolved confirmation block checkout and fulfillment", () => {
  const review = order({ paymentStatus: "review_required", paymentIssue: "INSUFFICIENT_STOCK", checkoutEligible: false });
  assert.equal(parseOrder(review), review);
  assert.equal(nextAction(review), null);
  assert.equal(paymentLabel(review), "Payment needs review");
  assert.throws(() => parseOrder({ ...review, checkoutEligible: true }));
  const unresolved = order({ paymentIssue: "PAYMENT_CONFIRMATION_PENDING", checkoutEligible: false });
  assert.equal(parseOrder(unresolved), unresolved);
  assert.throws(() => parseOrder({ ...unresolved, checkoutEligible: true }));
});

test("callback validation sends only provider IDs/signature, never frontend amounts or success claims", () => {
  const response = { razorpay_order_id: "order_abcdef123", razorpay_payment_id: "pay_123abc", razorpay_signature: "a".repeat(64), amount: 1, paid: true };
  assert.deepEqual(Object.keys(paymentCallback(response, response.razorpay_order_id)), ["razorpay_order_id", "razorpay_payment_id", "razorpay_signature"]);
  assert.throws(() => paymentCallback(response, "order_other"));
  assert.throws(() => paymentCallback({ ...response, razorpay_signature: "bad" }, response.razorpay_order_id));
  assert.throws(() => paymentCallback({ ...response, razorpay_payment_id: "bad" }, response.razorpay_order_id));
  assert.equal(order().paymentStatus, "pending");
});

test("checkout options use server euro amount and callbacks without automatic provider retry", () => {
  const calls = [];
  const options = checkoutOptions(checkout(), { onSuccess: (value) => calls.push(value), onDismiss: () => calls.push("cancel") });
  assert.equal(options.amount, 600); assert.equal(options.currency, "EUR"); assert.equal(options.order_id, "order_abcdef123");
  assert.equal(options.retry.enabled, false);
  options.modal.ondismiss(); options.handler("response");
  assert.deepEqual(calls, ["cancel", "response"]);
});

test("authorized payments and stock/capture failures clearly require reconciliation, not another payment", () => {
  assert.match(paymentError({ response: { data: { code: "PAYMENT_NOT_CAPTURED" } } }), /isn't captured/);
  assert.match(paymentError({ response: { data: { code: "INSUFFICIENT_STOCK", order: { paymentStatus: "review_required" } } } }), /Do not pay again/);
  assert.doesNotMatch(paymentError({ response: { data: { code: "INSUFFICIENT_STOCK" } } }), /payment was received/);
  assert.match(paymentError({ response: { data: { code: "PAYMENT_CONFIRMATION_PENDING" } } }), /Do not pay again/);
});

function scriptHarness() {
  const scripts = [], timers = new Map();
  const win = {};
  const document = { createElement: () => ({ remove() { this.removed = true; } }), head: { appendChild: (script) => scripts.push(script) } };
  const load = () => loadRazorpay(win, document, (fn) => { timers.set(1, fn); return 1; }, (id) => timers.delete(id));
  return { win, scripts, timers, load };
}

test("official script loads once when SDK exists and failed loading can retry", async () => {
  const h = scriptHarness();
  const failed = h.load();
  assert.equal(h.scripts[0].src, checkoutScript);
  h.scripts[0].onerror();
  await assert.rejects(failed, /couldn't load/);
  assert.equal(h.scripts[0].removed, true);
  const retry = h.load();
  h.win.Razorpay = function Razorpay() {};
  h.scripts[1].onload();
  assert.equal(await retry, h.win.Razorpay);
  assert.equal(await h.load(), h.win.Razorpay);
  assert.equal(h.scripts.length, 2);
  assert.equal(h.timers.size, 0);
});

test("script timeout and malformed successful load remain retryable errors", async () => {
  const h = scriptHarness();
  const timeout = h.load(); h.timers.get(1)();
  await assert.rejects(timeout, /too long/);
  const malformed = h.load(); h.scripts[1].onload();
  await assert.rejects(malformed, /didn't load correctly/);
});
