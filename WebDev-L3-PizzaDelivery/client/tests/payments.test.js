import test from "node:test";
import assert from "node:assert/strict";
import { checkoutUrl, parsePaymentConfig, parsePaymentSession, paymentError, paymentReturn } from "../src/components/orders/payment.js";
import { parseOrder } from "../src/components/orders/orderHelpers.js";
import { nextAction, paymentLabel } from "../src/components/orders/tracking.js";

const timestamp = "2026-10-09T10:00:00.000Z";
function order(overrides = {}) {
  return { id: "saved-order", currency: "EUR", quantity: 2,
    items: ["base", "sauce", "cheese"].map((category) => ({ ingredientId: category, category, name: category, unitPriceMinor: 100, quantity: 2, lineTotalMinor: 200 })),
    unitTotalMinor: 300, totalMinor: 600, status: "pending_payment", paymentStatus: "pending", paymentIssue: null, paymentProvider: "stripe",
    createdAt: timestamp, updatedAt: timestamp, fulfillmentStatus: null, fulfillmentHistory: [], confirmedAt: null, nextFulfillmentStatus: null,
    checkoutEligible: true, ...overrides };
}
const checkout = () => ({ provider: "stripe", sessionId: "cs_test_abcdef123", url: "https://checkout.stripe.com/c/pay/cs_test_abcdef123#test", amountMinor: 600, currency: "EUR" });

test("payment availability explicitly selects Stripe EUR test mode and reports webhook configuration", () => {
  const unavailable = { available: false, provider: "stripe", mode: "test", currency: "EUR", webhookConfigured: false, code: "PAYMENT_UNAVAILABLE", message: "Test payments unavailable." };
  assert.equal(parsePaymentConfig(unavailable).available, false);
  assert.equal(parsePaymentConfig({ ...unavailable, available: true, webhookConfigured: true, code: null, message: null }).available, true);
  for (const invalid of [{}, { ...unavailable, available: "true" }, { ...unavailable, mode: "live" }, { ...unavailable, currency: "INR" }, { ...unavailable, provider: "razorpay" }, { ...unavailable, webhookConfigured: "true" }]) assert.throws(() => parsePaymentConfig(invalid));
});

test("checkout requires matching server amount, currency, saved provider and test session", () => {
  const session = { order: order(), checkout: checkout() };
  assert.equal(parsePaymentSession(session, order()).checkout.amountMinor, 600);
  for (const invalid of [
    { ...checkout(), sessionId: "cs_live_abc" }, { ...checkout(), currency: "INR" },
    { ...checkout(), amountMinor: 601 }, { ...checkout(), provider: "razorpay" }, { ...checkout(), amountMinor: "600" },
  ]) assert.throws(() => parsePaymentSession({ ...session, checkout: invalid }, order()));
  assert.throws(() => parsePaymentSession({ ...session, order: order({ id: "someone-else" }) }, order()));
  assert.throws(() => parsePaymentSession({ ...session, order: order({ paymentProvider: "razorpay", checkoutEligible: false }) }, order()));
  assert.throws(() => parsePaymentSession({ ...session, checkout: null }, order()));
  assert.throws(() => parsePaymentSession({ ...session, order: order({ paymentIssue: "PAYMENT_SETUP_REVIEW", checkoutEligible: false }) }, order()));
});

test("hosted checkout rejects insecure links, credentials, lookalike hosts and unrelated Stripe paths", () => {
  assert.equal(checkoutUrl(checkout().url), checkout().url);
  for (const url of [undefined, "javascript:alert(1)", "http://checkout.stripe.com/c/pay/cs_test_ok", "https://checkout.stripe.com.evil.test/c/pay/cs_test_ok", "https://evil.test/c/pay/cs_test_ok", "https://user@checkout.stripe.com/c/pay/cs_test_ok", "https://checkout.stripe.com:444/c/pay/cs_test_ok", "https://checkout.stripe.com/login", "//checkout.stripe.com/c/pay/cs_test_ok"]) {
    assert.throws(() => checkoutUrl(url));
    assert.throws(() => parsePaymentSession({ order: order(), checkout: { ...checkout(), url } }, order()));
  }
});

test("only authoritative confirmed order permits recovered checkout without a redirect", () => {
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

test("existing Razorpay orders retain provider and cannot start the active Stripe checkout", () => {
  const legacy = order({ paymentProvider: "razorpay", checkoutEligible: false });
  assert.equal(parseOrder(legacy), legacy);
  assert.throws(() => parseOrder({ ...legacy, checkoutEligible: true }));
  assert.throws(() => parseOrder(order({ paymentProvider: "unknown" })));
  assert.equal(parseOrder(order({ paymentProvider: null })).checkoutEligible, true);
  assert.match(paymentError({ response: { data: { code: "PAYMENT_PROVIDER_PRESERVED" } } }), /cannot switch to Stripe/);
});

test("redirect parameters are notices for backend reconciliation, never proof of payment", () => {
  assert.equal(paymentReturn("?payment=success&session_id=cs_test_untrusted&paid=true"), "success");
  assert.equal(paymentReturn("?payment=cancelled"), "cancelled");
  for (const query of ["", "?paid=true", "?payment=paid", "?payment=https://evil.test", "?session_id=cs_test_untrusted"]) assert.equal(paymentReturn(query), null);
  assert.equal(order().paymentStatus, "pending");
});

test("processing payments and stock failures require reconciliation instead of another payment", () => {
  assert.match(paymentError({ response: { data: { code: "PAYMENT_NOT_CAPTURED" } } }), /still processing/);
  assert.match(paymentError({ response: { data: { code: "INSUFFICIENT_STOCK", order: { paymentStatus: "review_required" } } } }), /Do not pay again/);
  assert.doesNotMatch(paymentError({ response: { data: { code: "INSUFFICIENT_STOCK" } } }), /payment was received/);
  assert.match(paymentError({ response: { data: { code: "PAYMENT_CONFIRMATION_PENDING" } } }), /Do not pay again/);
});
