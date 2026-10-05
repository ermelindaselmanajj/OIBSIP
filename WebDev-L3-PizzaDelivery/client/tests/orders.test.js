import test from "node:test";
import assert from "node:assert/strict";
import { draftKey, matchingAttempt, prepareAttempt, readDraft, writeDraft } from "../src/components/orders/draft.js";
import { formatMoney, orderSelection, parseOrder, parseQuote, selectionFromItems, selectionSignature } from "../src/components/orders/orderHelpers.js";

const selection = () => ({ base: "b", sauce: "s", cheese: "c", vegetables: ["v2", "v1"] });
function quote(quantity = 2, amount = 100) {
  const items = [["b", "base"], ["s", "sauce"], ["c", "cheese"], ["v1", "vegetable"], ["v2", "vegetable"]].map(([ingredientId, category]) => ({ ingredientId, category, name: ingredientId, unitPriceMinor: amount, quantity, lineTotalMinor: amount * quantity }));
  return { currency: "EUR", quantity, items, unitTotalMinor: amount * 5, totalMinor: amount * 5 * quantity, fingerprint: "a".repeat(64) };
}

test("selection payload contains only IDs/quantity, stable across vegetable ordering", () => {
  assert.deepEqual(orderSelection(selection(), 2), { baseId: "b", sauceId: "s", cheeseId: "c", vegetableIds: ["v1", "v2"], quantity: 2 });
  assert.equal(selectionSignature(selection(), 2), selectionSignature({ ...selection(), vegetables: ["v1", "v2"] }, 2));
});

test("server quote validates amounts, matching IDs/categories, unique items and fingerprint", () => {
  const valid = quote();
  assert.equal(parseQuote(valid, 2, orderSelection(selection(), 2)), valid);
  for (const invalid of [
    { ...valid, quantity: 11 }, { ...valid, currency: "INR" }, { ...valid, totalMinor: 999 },
    { ...valid, fingerprint: "bad" }, { ...valid, items: [...valid.items, valid.items[0]] },
    { ...valid, items: valid.items.map((item) => ({ ...item, name: "" })) },
    { ...valid, items: valid.items.map((item) => item.category === "base" ? { ...item, category: "vegetable" } : item) },
  ]) assert.throws(() => parseQuote(invalid, 2));
  assert.throws(() => parseQuote(valid, 1));
  assert.throws(() => parseQuote(valid, 2, { ...orderSelection(selection(), 2), baseId: "another" }));
  assert.match(formatMoney(12345), /123\.45/);
  assert.match(formatMoney(12345), /€/);
});

test("uncertain retry keeps original key and fingerprint despite fresh price/stock", () => {
  const first = prepareAttempt(null, selection(), 2, quote(), () => "key-one");
  const changedQuote = { ...quote(2, 200), fingerprint: "b".repeat(64) };
  const replay = prepareAttempt(first, selection(), 2, changedQuote, () => "must-not-be-used");
  assert.equal(replay.idempotencyKey, "key-one");
  assert.equal(replay.quote.fingerprint, "a".repeat(64));
  assert.equal(replay.quote.totalMinor, first.quote.totalMinor);
  const changedQuantity = prepareAttempt(first, selection(), 3, quote(3), () => "key-two");
  assert.equal(changedQuantity.idempotencyKey, "key-two");
  const changedChoice = prepareAttempt(first, { ...selection(), base: "new" }, 2, changedQuote, () => "key-three");
  assert.equal(changedChoice.idempotencyKey, "key-three");
});

test("definitive price change preserves key while requiring the new reviewed quote", () => {
  const previous = { ...prepareAttempt(null, selection(), 2, quote(), () => "stable"), state: "ready" };
  const updated = { ...quote(2, 200), fingerprint: "b".repeat(64) };
  const next = prepareAttempt(previous, selection(), 2, updated, () => "unused");
  assert.equal(next.idempotencyKey, "stable");
  assert.equal(next.quote.fingerprint, updated.fingerprint);
});

test("draft and uncertain attempt survive reload, scope separates identities and APIs", () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const key = draftKey("http://api-one", "user-one");
  const attempt = prepareAttempt(null, selection(), 2, quote(), () => "saved");
  assert.equal(writeDraft(storage, key, { selection: selection(), quantity: 2, step: 5, attempt }), true);
  const recovered = readDraft(storage, key);
  assert.equal(matchingAttempt(recovered.attempt, recovered.selection, recovered.quantity).idempotencyKey, "saved");
  assert.equal(readDraft(storage, draftKey("http://api-one", "user-two")), null);
  assert.equal(readDraft(storage, draftKey("http://api-two", "user-one")), null);
  storage.setItem("bad", "not json");
  assert.equal(readDraft(storage, "bad"), null);
  storage.setItem("bad", JSON.stringify({ selection: selection(), quantity: 0 }));
  assert.equal(readDraft(storage, "bad"), null);
  assert.equal(writeDraft({ setItem() { throw new Error("storage blocked"); } }, key, {}), false);
});

test("saved order validates pending status and edit restores IDs/quantity", () => {
  const order = { ...quote(), id: "order-one", status: "pending_payment", checkoutEligible: true, createdAt: "2026-10-05T10:00:00.000Z" };
  assert.equal(parseOrder(order), order);
  assert.throws(() => parseOrder({ ...order, status: "paid" }));
  assert.throws(() => parseOrder({ ...order, createdAt: "not a date" }));
  assert.deepEqual(selectionFromItems(order.items), { ...selection(), vegetables: ["v1", "v2"] });
});

test("legacy INR orders preserve snapshots but cannot become EUR quotes or checkout", () => {
  const legacy = { ...quote(2, 1500), currency: "INR", id: "old-order", status: "pending_payment", checkoutEligible: false, createdAt: "2026-10-05T10:00:00.000Z" };
  const original = JSON.stringify(legacy);
  assert.equal(parseOrder(legacy), legacy);
  assert.throws(() => parseQuote(legacy, 2));
  assert.throws(() => parseOrder({ ...legacy, checkoutEligible: true }));
  assert.throws(() => parseOrder({ ...legacy, currency: "USD" }));
  assert.match(formatMoney(legacy.totalMinor, legacy.currency), /₹/);
  assert.deepEqual(selectionFromItems(legacy.items), { ...selection(), vegetables: ["v1", "v2"] });
  assert.equal(JSON.stringify(legacy), original);
  const attempt = { signature: selectionSignature(selection(), 2), idempotencyKey: "legacy-retry", quote: legacy, state: "uncertain" };
  assert.equal(matchingAttempt(attempt, selection(), 2), attempt);
});
