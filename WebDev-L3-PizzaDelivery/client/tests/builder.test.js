import test from "node:test";
import assert from "node:assert/strict";
import { canAdvance, earliestInvalidStep, emptySelection, reconcileSelection, refreshBuilder, selectIngredient } from "../src/components/builder/selection.js";
import { parseIngredients } from "../src/components/builder/ingredients.js";

const ingredients = [
  { id: "b", category: "base", available: true },
  { id: "s", category: "sauce", available: true },
  { id: "c", category: "cheese", available: true },
  { id: "v1", category: "vegetable", available: true },
  { id: "v2", category: "vegetable", available: true },
  { id: "out", category: "base", available: false },
];
const complete = () => ({ base: "b", sauce: "s", cheese: "c", vegetables: ["v1", "v2"] });

test("builder parses all four API categories without dropping out-of-stock ingredients", () => {
  const rows = ingredients.map((item) => ({ ...item, name: item.id }));
  const parsed = parseIngredients({ ingredients: rows });
  assert.equal(parsed, rows);
  for (const category of ["base", "sauce", "cheese", "vegetable"]) {
    assert.ok(parsed.filter((item) => item.category === category).length > 0);
  }
  assert.equal(parsed.find((item) => item.id === "out").available, false);
  assert.deepEqual(parseIngredients({ ingredients: [] }), []);
});

test("malformed builder payloads throw instead of becoming an empty menu", () => {
  const row = { id: "b", name: "Base", category: "base", available: true };
  for (const body of [null, {}, { items: [] }, { ingredients: null }, { ingredients: {} },
    { ingredients: [null] }, { ingredients: [{ ...row, category: "bases" }] },
    { ingredients: [{ ...row, available: 1 }] }, { ingredients: [{ ...row, id: " " }] },
    { ingredients: [{ ...row, name: " " }] }, { ingredients: [row, row] }]) {
    assert.throws(() => parseIngredients(body), /Please retry/);
  }
});

test("unavailable options cannot be chosen; vegetables toggle independently", () => {
  const initial = emptySelection();
  assert.equal(selectIngredient(initial, ingredients[5], ingredients), initial);
  let selected = selectIngredient(initial, ingredients[3], ingredients);
  selected = selectIngredient(selected, ingredients[4], ingredients);
  assert.deepEqual(selected.vegetables, ["v1", "v2"]);
  selected = selectIngredient(selected, ingredients[3], ingredients);
  assert.deepEqual(selected.vegetables, ["v2"]);
});

test("advance requires current and earlier selections, fresh data, and available vegetables", () => {
  assert.equal(canAdvance(1, emptySelection(), ingredients, "ready"), false);
  assert.equal(canAdvance(1, { ...emptySelection(), base: "b" }, ingredients, "ready"), true);
  for (const status of ["loading", "error"]) assert.equal(canAdvance(4, complete(), ingredients, status), false);
  assert.equal(canAdvance(3, { ...complete(), base: "out" }, ingredients, "ready"), false);
  assert.equal(canAdvance(4, { ...complete(), vegetables: ["missing"] }, ingredients, "ready"), false);
  assert.equal(canAdvance(4, { ...complete(), vegetables: [] }, ingredients, "ready"), true);
});

test("refresh removes sold-out, deleted and recategorized choices, returning earliest invalid step", () => {
  const updated = ingredients.filter((item) => item.id !== "s").map((item) => item.id === "b" ? { ...item, available: false } : item.id === "c" ? { ...item, category: "vegetable" } : item.id === "v1" ? { ...item, available: false } : item);
  const result = reconcileSelection(complete(), updated);
  assert.equal(result.changed, true);
  assert.deepEqual(result.selection, { base: "", sauce: "", cheese: "", vegetables: ["v2"] });
  assert.equal(earliestInvalidStep(result.selection, updated), 1);
  assert.equal(canAdvance(5, result.selection, updated, "ready"), false);
});

test("vegetable stock loss allows empty optional selection; valid required picks survive", () => {
  const updated = ingredients.map((item) => item.category === "vegetable" ? { ...item, available: false } : item);
  const result = reconcileSelection(complete(), updated);
  assert.deepEqual(result.selection.vegetables, []);
  assert.equal(earliestInvalidStep(result.selection, updated), 5);
  assert.equal(canAdvance(4, result.selection, updated, "ready"), true);
  assert.equal(reconcileSelection(result.selection, updated).changed, false);
});

test("Continue refresh cannot advance stale choices and returns the earliest invalid step", () => {
  const previous = { step: 4, selection: complete(), notice: "" };
  const changedStock = ingredients.map((item) => item.id === "s" ? { ...item, available: false } : item);
  const rejected = refreshBuilder(previous, changedStock, 5);
  assert.equal(rejected.step, 2);
  assert.equal(rejected.selection.sauce, "");
  assert.match(rejected.notice, /Availability changed/);
  assert.equal(refreshBuilder(previous, ingredients, 5).step, 5);
  assert.equal(refreshBuilder({ ...previous, step: 1 }, ingredients, 5).step, 1);
});
