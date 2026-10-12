import test from "node:test";
import assert from "node:assert/strict";
import { parseMenu } from "../src/services/menu.js";

test("menu accepts valid euro prices and an empty menu", () => {
  const pizzas = [{ _id: "pizza", name: "Margherita", price: 7.5, image: "original.jpg" }];
  assert.equal(parseMenu(pizzas), pizzas);
  assert.deepEqual(parseMenu([]), []);
});

test("malformed menu cards become a retryable error instead of crashing or showing NaN", () => {
  for (const data of [{}, [null], [{ _id: "pizza", name: "Margherita", price: "7.50" }],
    [{ _id: "pizza", name: "Margherita", price: NaN }], [{ _id: "pizza", name: "", price: 5 }],
    [{ _id: "pizza", name: "Margherita", price: -5 }]]) {
    assert.throws(() => parseMenu(data), /Please retry/);
  }
});
