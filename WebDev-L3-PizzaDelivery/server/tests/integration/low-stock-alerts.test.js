// Run explicitly with npm run test:stock-alerts:integration. All writes are
// confined to a new, randomly named database; SMTP is always simulated.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const mongoose = require("mongoose");
const { createLowStockChecker } = require("../../services/lowStockAlerts");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

test("low-stock alerts with isolated MongoDB and simulated SMTP", { timeout: 120000 }, async t => {
  assert.ok(process.env.MONGO_URI, "An existing MONGO_URI is required; its value is never logged.");
  const dbName = `pizza_stock_alert_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const connection = mongoose.createConnection();
  t.after(async () => {
    try {
      if (connection.readyState === 1) {
        assert.equal(connection.name, dbName);
        assert.ok(connection.name.startsWith("pizza_stock_alert_test_"));
        await connection.dropDatabase();
        t.diagnostic("Isolated database dropped successfully. SMTP was simulated throughout.");
      }
    } finally { await connection.close(); }
  });
  try {
    await connection.openUri(process.env.MONGO_URI, { dbName, serverSelectionTimeoutMS: 10000 });
  } catch {
    assert.fail("Cannot connect to the isolated test database. Check network/database permissions privately.");
  }
  assert.equal(connection.name, dbName);
  const Inventory = connection.model("Inventory", require("../../models/Inventory").schema);
  const Admin = connection.model("Admin", require("../../models/Admin").schema);
  const Delivery = connection.model("StockAlertDelivery", require("../../models/StockAlertDelivery").schema);
  await Promise.all([Inventory.init(), Admin.init(), Delivery.createIndexes()]);
  const logs = [];
  const logger = { error(message) { logs.push(message); } };
  const deps = { inventory: Inventory, admins: Admin, deliveries: Delivery, logger };

  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../controllers/inventoryController.js"), "utf8"), {
    module, require(name) {
      if (name === "../models/Inventory") return Inventory;
      if (name === "node:crypto") return require("node:crypto");
      if (name === "../services/pricing") return require("../../services/pricing");
      throw new Error("Unexpected controller dependency");
    },
  });
  async function update(item, body) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
    await module.exports.updateInventory({ params: { id: String(item._id) }, body }, res);
    assert.equal(res.statusCode, 200);
    return Inventory.findById(item._id).lean();
  }
  async function reset() {
    await Promise.all([Inventory.deleteMany({}), Admin.deleteMany({}), Delivery.deleteMany({})]);
    logs.length = 0;
    await Admin.create({ email: "verified@example.test", password: "fixture-hash", isVerified: true });
  }
  const item = patch => Inventory.create({ name: "Classic Thin", category: "base", stock: 20, threshold: 20, priceCurrency: "EUR", priceMinor: 400, ...patch });
  const accepted = async ({ to }) => ({ accepted: [to], rejected: [] });

  await t.test("threshold equality, below, zero and all ingredient categories; counts/prices untouched", async () => {
    await reset();
    await Inventory.create([
      { name: "Equal", category: "base", stock: 20, threshold: 20 },
      { name: "Below", category: "sauce", stock: 19, threshold: 20 },
      { name: "Zero", category: "cheese", stock: 0, threshold: 0 },
      { name: "Fresh", category: "vegetable", stock: 1, threshold: 2 },
      { name: "Above", category: "base", stock: 21, threshold: 20 },
    ]);
    const before = await Inventory.find().sort({ _id: 1 }).select("-lowStockAlertEpisode").lean();
    const messages = [];
    const checker = createLowStockChecker({ ...deps, mail: async message => { messages.push(message); return accepted(message); } });
    assert.equal((await checker()).sent, 1);
    assert.equal(messages.length, 1);
    for (const name of ["Equal", "Below", "Zero", "Fresh"]) assert.ok(messages[0].text.includes(name));
    assert.ok(!messages[0].text.includes("Above"));
    assert.equal(await Delivery.countDocuments(), 4);
    assert.deepEqual(await Inventory.find().sort({ _id: 1 }).select("-lowStockAlertEpisode").lean(), before);
    assert.equal((await checker()).sent, 0);
    assert.equal(messages.length, 1);
  });

  await t.test("persisted deliveries survive a new checker and a new MongoDB connection", async () => {
    await reset(); await item();
    assert.equal((await createLowStockChecker({ ...deps, mail: accepted })()).sent, 1);
    const reopened = await mongoose.createConnection(process.env.MONGO_URI, { dbName, serverSelectionTimeoutMS: 10000 }).asPromise();
    try {
      const restarted = createLowStockChecker({
        ...deps, inventory: reopened.model("Inventory", Inventory.schema),
        admins: reopened.model("Admin", Admin.schema), deliveries: reopened.model("StockAlertDelivery", Delivery.schema),
        mail: async () => { assert.fail("Restart must not resend"); },
      });
      assert.equal((await restarted()).sent, 0);
    } finally { await reopened.close(); }
    assert.equal(await Delivery.countDocuments(), 1);
  });

  await t.test("manual restock between cron runs opens a new episode; low edits do not resend", async () => {
    await reset(); const record = await item();
    const checker = createLowStockChecker({ ...deps, mail: accepted });
    assert.equal((await checker()).sent, 1);
    const first = await Inventory.findById(record._id).lean();
    await update(record, { stock: 19 });
    assert.equal((await checker()).sent, 0);
    assert.equal((await update(record, { stock: 21 })).lowStockAlertEpisode, null);
    const lowAgain = await update(record, { stock: 20 });
    assert.notEqual(lowAgain.lowStockAlertEpisode, first.lowStockAlertEpisode);
    assert.equal((await checker()).sent, 1);
    assert.equal(await Delivery.countDocuments(), 2);
    // A threshold change can also resolve and later reopen the condition.
    assert.equal((await update(record, { threshold: 19 })).lowStockAlertEpisode, null);
    await update(record, { threshold: 20 });
    assert.equal((await checker()).sent, 1);
    assert.equal(await Delivery.countDocuments(), 3);
  });

  await t.test("scheduler notices external restocking and permits a later alert", async () => {
    await reset(); const record = await item();
    const checker = createLowStockChecker({ ...deps, mail: accepted });
    await checker();
    await Inventory.updateOne({ _id: record._id }, { $set: { stock: 21 } });
    assert.equal((await checker()).sent, 0);
    assert.equal((await Inventory.findById(record._id)).lowStockAlertEpisode, null);
    await Inventory.updateOne({ _id: record._id }, { $set: { stock: 20 } });
    assert.equal((await checker()).sent, 1);
  });

  await t.test("SMTP failures, missing acceptance and rejections are retried, never marked sent", async () => {
    for (const mail of [async () => { throw new Error("private SMTP credentials"); }, async () => ({}), async () => ({ accepted: [], rejected: ["verified@example.test"] })]) {
      await reset(); await item();
      assert.equal((await createLowStockChecker({ ...deps, mail })()).failed, 1);
      assert.equal(await Delivery.countDocuments(), 0);
      assert.equal((await createLowStockChecker({ ...deps, mail: accepted })()).sent, 1);
      assert.equal(await Delivery.countDocuments(), 1);
      assert.ok(logs.every(message => !message.includes("private")));
    }
  });

  await t.test("only verified admins receive mail; each recipient has independent retry state", async () => {
    await reset(); await item();
    await Admin.create([
      { email: "second@example.test", password: "fixture-hash", isVerified: true },
      { email: "VERIFIED@example.test", password: "fixture-hash", isVerified: true },
      { email: "unverified@example.test", password: "fixture-hash", isVerified: false },
    ]);
    await Admin.collection.insertOne({ email: "legacy@example.test", password: "fixture-hash" });
    await connection.collection("users").insertOne({ email: "user@example.test", isVerified: true });
    const attempts = [];
    const result = await createLowStockChecker({ ...deps, mail: async message => {
      attempts.push(message.to);
      if (message.to === "second@example.test") throw new Error("SMTP fixture failure");
      return accepted(message);
    } })();
    assert.deepEqual(new Set(attempts), new Set(["verified@example.test", "second@example.test"]));
    assert.equal(result.sent, 1); assert.equal(result.failed, 1);
    assert.equal(await Delivery.countDocuments(), 1);
    const retried = [];
    await createLowStockChecker({ ...deps, mail: async message => { retried.push(message.to); return accepted(message); } })();
    assert.deepEqual(retried, ["second@example.test"]);
    assert.equal(await Delivery.countDocuments(), 2);
    await Admin.updateOne({ email: "new@example.test" }, { $set: { password: "fixture-hash", isVerified: true } }, { upsert: true });
    const newRecipient = [];
    await createLowStockChecker({ ...deps, mail: async message => { newRecipient.push(message.to); return accepted(message); } })();
    assert.deepEqual(newRecipient, ["new@example.test"]);
  });

  await t.test("overlapping checks are skipped while SMTP is pending; no early sent record", async () => {
    await reset(); await item();
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    let calls = 0;
    const checker = createLowStockChecker({ ...deps, mail: async message => { calls++; entered(); await gate; return accepted(message); } });
    const first = checker();
    await started;
    assert.equal(await Delivery.countDocuments(), 0);
    assert.deepEqual(await checker(), { skipped: true });
    release(); await first;
    assert.equal(calls, 1); assert.equal(await Delivery.countDocuments(), 1);
    assert.equal((await checker()).sent, 0);
  });

  await t.test("restocking during digest preparation cancels stale sends", async () => {
    await reset(); const record = await item();
    const checker = createLowStockChecker({ ...deps,
      deliveries: {
        createIndexes: () => Delivery.createIndexes(),
        find: async query => { await update(record, { stock: 50 }); return Delivery.find(query); },
      },
      mail: async () => { assert.fail("A restocked ingredient must not be emailed"); },
    });
    assert.equal((await checker()).sent, 0);
    assert.equal(await Delivery.countDocuments(), 0);
  });

  await t.test("empty inventory produces no SMTP call and pending payment statuses stay unchanged", async () => {
    await reset();
    const orders = connection.collection("orders");
    await orders.insertOne({ status: "pending_payment", paymentStatus: "pending", totalMinor: 900, currency: "EUR" });
    const before = await orders.find().toArray();
    const checker = createLowStockChecker({ ...deps, mail: async () => { assert.fail("No ingredients to send"); } });
    assert.equal((await checker()).sent, 0);
    assert.deepEqual(await orders.find().toArray(), before);
  });
});
