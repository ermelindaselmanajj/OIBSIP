import test from "node:test";
import assert from "node:assert/strict";
import { nextAction, parseOrderList, validateTracking } from "../src/components/orders/tracking.js";
import { startVisiblePolling } from "../src/components/orders/visiblePoll.js";

const timestamp = "2026-10-07T10:00:00.000Z";
const pending = () => ({ status: "pending_payment", paymentStatus: "pending", fulfillmentStatus: null, fulfillmentHistory: [], confirmedAt: null, updatedAt: timestamp, nextFulfillmentStatus: null });
const paid = () => ({ ...pending(), status: "confirmed", paymentStatus: "paid", confirmedAt: timestamp, fulfillmentStatus: "order_received", fulfillmentHistory: [{ status: "order_received", at: timestamp }], nextFulfillmentStatus: "in_kitchen" });

test("only paid confirmed orders expose the server's valid next step", () => {
  assert.equal(nextAction(pending()), null);
  assert.equal(nextAction({ ...pending(), nextFulfillmentStatus: "order_received" }), null);
  assert.equal(nextAction(paid()), "in_kitchen");
  assert.equal(nextAction({ ...paid(), fulfillmentStatus: null, nextFulfillmentStatus: "order_received" }), null);
  assert.equal(nextAction({ ...paid(), status: "pending_payment" }), null);
  assert.equal(nextAction({ ...paid(), fulfillmentStatus: "order_received", nextFulfillmentStatus: "in_kitchen" }), "in_kitchen");
  assert.equal(nextAction({ ...paid(), fulfillmentStatus: "in_kitchen", nextFulfillmentStatus: "sent_to_delivery" }), "sent_to_delivery");
  assert.equal(nextAction({ ...paid(), fulfillmentStatus: "sent_to_delivery", nextFulfillmentStatus: null }), null);
  assert.equal(nextAction({ ...paid(), nextFulfillmentStatus: "sent_to_delivery" }), null);
});

test("tracking and pagination reject malformed server data", () => {
  assert.equal(validateTracking(pending()).paymentStatus, "pending");
  assert.throws(() => validateTracking({ ...paid(), fulfillmentHistory: [{ status: "in_kitchen", at: "invalid" }] }));
  assert.throws(() => validateTracking({ ...pending(), paymentStatus: "unknown" }));
  assert.throws(() => parseOrderList({ orders: [] }, (order) => order));
  assert.deepEqual(parseOrderList({ orders: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } }, (order) => order).orders, []);
});

function harness() {
  const listeners = new Map();
  const doc = { visibilityState: "visible", addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: (event) => listeners.delete(event) };
  const timers = new Map();
  let timerId = 0;
  const requests = [];
  const successes = [];
  const errors = [];
  const polling = startVisiblePolling({
    document: doc,
    load: (signal) => new Promise((resolve, reject) => requests.push({ signal, resolve, reject })),
    onSuccess: (value) => successes.push(value), onError: (error) => errors.push(error),
    setTimer: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  return { polling, requests, successes, errors, timers, listeners, visibility(value) { doc.visibilityState = value; listeners.get("visibilitychange")?.(); } };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("polls only after completion every five seconds; refresh cannot overlap requests", async () => {
  const h = harness();
  assert.equal(h.requests.length, 1);
  h.polling.refresh();
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 0);
  h.requests[0].resolve("first");
  await flush();
  assert.deepEqual(h.successes, ["first"]);
  assert.equal(h.timers.size, 1);
  const [{ fn, delay }] = [...h.timers.values()];
  assert.equal(delay, 5000);
  fn();
  assert.equal(h.requests.length, 2);
  h.polling.stop();
  assert.equal(h.requests[1].signal.aborted, true);
  assert.equal(h.timers.size, 0);
});

test("hidden tabs cancel requests/timers; visible tabs refresh immediately and ignore late responses", async () => {
  const h = harness();
  h.visibility("hidden");
  assert.equal(h.requests[0].signal.aborted, true);
  h.polling.refresh();
  assert.equal(h.requests.length, 1);
  h.visibility("visible");
  assert.equal(h.requests.length, 2);
  h.requests[0].resolve("stale");
  h.requests[1].resolve("fresh");
  await flush();
  assert.deepEqual(h.successes, ["fresh"]);
  h.visibility("hidden");
  assert.equal(h.timers.size, 0);
  h.polling.stop();
  assert.equal(h.listeners.size, 0);
});

test("network failure surfaces an error and schedules recovery; stopped requests cannot update", async () => {
  const h = harness();
  h.requests[0].reject(new Error("offline"));
  await flush();
  assert.equal(h.errors.length, 1);
  assert.equal(h.timers.size, 1);
  h.polling.refresh();
  h.polling.stop();
  h.requests[1].resolve("after unmount");
  await flush();
  assert.deepEqual(h.successes, []);
  assert.equal(h.timers.size, 0);
});
