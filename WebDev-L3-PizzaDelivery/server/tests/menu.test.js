const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { seedPizzas, pizzas } = require("../seedPizzas");

test("menu seeding adds missing pizzas and preserves IDs, prices and photos on repeated runs", async () => {
  const original = { _id: "existing", name: pizzas[0].name, price: 12.75, image: "original.jpg" };
  const rows = [{ ...original }];
  let disconnects = 0;
  const db = { connect: async () => {}, disconnect: async () => { disconnects++; } };
  const Pizza = { updateOne: async (filter, update, options) => {
    assert.equal(options.upsert, true);
    assert.deepEqual(Object.keys(update), ["$setOnInsert"]);
    if (!rows.some(row => row.name === filter.name)) rows.push({ _id: `fixture-${rows.length}`, ...update.$setOnInsert });
  } };
  await seedPizzas({ mongoose: db, Pizza });
  const once = structuredClone(rows);
  await seedPizzas({ mongoose: db, Pizza });
  assert.equal(rows.length, 6);
  assert.deepEqual(rows, once);
  assert.deepEqual(rows[0], original);
  assert.equal(disconnects, 2);
});

test("menu seed disconnects on failure and catalog errors do not expose driver details", async () => {
  let closed = false;
  await assert.rejects(seedPizzas({ mongoose: { connect: async () => {}, disconnect: async () => { closed = true; } },
    Pizza: { updateOne: async () => { throw new Error("simulated database failure"); } } }));
  assert.equal(closed, true);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../controllers/pizzaController.js"), "utf8"), {
    module, require: () => ({ find: async () => { throw new Error("private connection details"); } }),
  });
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  await module.exports.getPizzas({}, res);
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.stringify(res.body), JSON.stringify({ message: "Failed to fetch pizzas" }));
});
