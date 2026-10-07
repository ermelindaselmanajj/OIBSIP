const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createLowStockScheduler } = require("../services/lowStockScheduler");
const { createLowStockChecker, alertMessage } = require("../services/lowStockAlerts");
const Admin = require("../models/Admin");

test("new admins are unverified and legacy accounts are not implicitly verified", () => {
  assert.equal(new Admin({ email: "admin@example.test", password: "fixture-hash" }).isVerified, false);
});

test("alert digest includes categories, boundary counts and escapes ingredient names", () => {
  const message = alertMessage([
    { name: '<Thin & Crisp>', category: "base", stock: 20, threshold: 20 },
    { name: "Mozzarella", category: "cheese", stock: 0, threshold: 0 },
  ], "https://example.test/admin/dashboard");
  assert.match(message.text, /<Thin & Crisp> \(Pizza base\): stock 20, threshold 20/);
  assert.match(message.text, /Mozzarella \(Cheese\): stock 0, threshold 0/);
  assert.match(message.html, /&lt;Thin &amp; Crisp&gt;/);
  assert.doesNotMatch(message.html, /<Thin & Crisp>/);
});

test("no verified recipients means no inventory writes or emails", async () => {
  const checker = createLowStockChecker({
    admins: { find(query) {
      assert.deepEqual(query, { isVerified: true });
      return { select: () => ({ lean: async () => [
        { email: "legacy@example.test" }, { email: "unverified@example.test", isVerified: false },
        { email: "bad-address", isVerified: true },
      ] }) };
    } },
    inventory: new Proxy({}, { get() { throw new Error("Inventory must not be touched"); } }),
    deliveries: {}, mail: async () => { throw new Error("Mail must not be sent"); },
  });
  assert.deepEqual(await checker(), { sent: 0, failed: 0, recipients: 0 });
});

test("scheduler uses node-cron, starts once, handles failures safely and can stop", async () => {
  const calls = [], messages = [];
  let destroyed = 0;
  const task = { destroy() { destroyed++; } };
  const scheduler = createLowStockScheduler({
    scheduler: { validate: () => true, schedule(...args) { calls.push(args); return task; } },
    check: async () => { throw new Error("private database details"); },
    logger: { error(message) { messages.push(message); } },
  });
  assert.equal(scheduler.start({}), task);
  assert.equal(scheduler.start({}), task);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "*/15 * * * *");
  assert.deepEqual(calls[0][2], { name: "low-stock-alerts", timezone: "UTC", noOverlap: true });
  await calls[0][1]();
  assert.equal(messages.length, 1);
  assert.doesNotMatch(messages[0], /private/);
  scheduler.stop(); scheduler.stop();
  assert.equal(destroyed, 1);
});

test("scheduler accepts configured cadence, can be disabled and rejects invalid cron", () => {
  let expression;
  const scheduler = createLowStockScheduler({
    scheduler: {
      validate: value => value !== "invalid",
      schedule(value) { expression = value; return { destroy() {} }; },
    }, check: async () => {},
  });
  assert.equal(scheduler.start({ LOW_STOCK_ALERTS_ENABLED: "false" }), undefined);
  assert.equal(expression, undefined);
  assert.throws(() => scheduler.start({ LOW_STOCK_CRON: "invalid" }), /LOW_STOCK_CRON/);
  scheduler.start({ LOW_STOCK_CRON: "0 * * * *" });
  assert.equal(expression, "0 * * * *");
  scheduler.stop();
});

test("installed node-cron task can execute and singleton startup returns the same task", async () => {
  let checks = 0;
  const scheduler = createLowStockScheduler({ check: async () => { checks++; } });
  const task = scheduler.start({ LOW_STOCK_CRON: "0 0 1 1 *" });
  try {
    assert.equal(scheduler.start({}), task);
    await task.execute();
    assert.equal(checks, 1);
  } finally { scheduler.stop(); }
});

test("checker clears the overlap guard even when the database request fails", async () => {
  let requests = 0;
  const checker = createLowStockChecker({
    admins: { find() { requests++; throw new Error("fixture database failure"); } },
  });
  await assert.rejects(checker(), /fixture database failure/);
  await assert.rejects(checker(), /fixture database failure/);
  assert.equal(requests, 2);
});

test("shared mail service reuses SMTP settings, bounds timeouts and returns acceptance", async () => {
  let settings, message;
  const accepted = { accepted: ["admin@example.test"], rejected: [] };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../utils/sendEmail.js"), "utf8"), {
    module,
    process: { env: { MAILTRAP_HOST: "smtp.example.test", MAILTRAP_PORT: "2525", MAILTRAP_USER: "fixture-user", MAILTRAP_PASS: "fixture-pass" } },
    require: () => ({ createTransport(value) {
      settings = value;
      return { sendMail: async value => { message = value; return accepted; } };
    } }),
  });
  assert.equal(await module.exports({ to: "admin@example.test", subject: "Stock", html: "<p>Stock</p>", text: "Stock" }), accepted);
  assert.equal(settings.host, "smtp.example.test");
  assert.equal(settings.port, 2525);
  assert.equal(settings.auth.user, "fixture-user");
  assert.equal(settings.auth.pass, "fixture-pass");
  assert.equal(settings.socketTimeout, 30000);
  assert.equal(message.text, "Stock");
});
