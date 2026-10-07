const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const mongoose = require("mongoose");
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { createAdminVerificationController, hashToken, LINK_LIFETIME_MS } = require("../../controllers/adminVerificationController");
const { createLowStockChecker } = require("../../services/lowStockAlerts");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

function load(file, dependencies, env) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8"), {
    module, process: { env }, require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error("Unexpected fixture dependency");
    },
  });
  return module.exports;
}

test("admin mailbox ownership with isolated MongoDB, real HTTP/JWT and simulated SMTP", { timeout: 120000 }, async t => {
  assert.ok(process.env.MONGO_URI, "The existing MONGO_URI is required; its value is never displayed.");
  const dbName = `pizza_admin_verify_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const connection = mongoose.createConnection();
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    try {
      if (connection.readyState === 1) {
        assert.equal(connection.name, dbName);
        assert.ok(connection.name.startsWith("pizza_admin_verify_test_"));
        await connection.dropDatabase();
        t.diagnostic("Isolated admin verification database dropped. All SMTP sends were simulated.");
      }
    } finally { await connection.close(); }
  });
  try { await connection.openUri(process.env.MONGO_URI, { dbName, serverSelectionTimeoutMS: 10000 }); }
  catch { assert.fail("Could not connect to the isolated test database; check network access privately."); }
  assert.equal(connection.name, dbName);
  const Admin = connection.model("Admin", require("../../models/Admin").schema);
  const User = connection.model("User", require("../../models/User").schema);
  const Inventory = connection.model("Inventory", require("../../models/Inventory").schema);
  const Delivery = connection.model("StockAlertDelivery", require("../../models/StockAlertDelivery").schema);
  await Promise.all([Admin.init(), User.init(), Inventory.init(), Delivery.createIndexes()]);
  const secret = "admin-verification-isolated-jwt-fixture";
  const fixturePassword = randomUUID();
  const passwordHash = await bcrypt.hash(fixturePassword, 4);
  const logger = { error() {} };
  let clock, admin, other, user, origin, clientOrigin = "https://client.example.test";
  let messages = [], mailBehavior = async message => ({ accepted: [message.to], rejected: [] });
  const dependencies = {
    admins: Admin, now: () => new Date(clock), logger,
    urls: { serverUrl: () => origin, clientUrl: () => clientOrigin },
    mail: async message => { messages.push(message); return mailBehavior(message); },
  };
  let verification = createAdminVerificationController(dependencies);
  const auth = load("middleware/auth.js", { jsonwebtoken: jwt, "../models/Admin": Admin, "../models/User": User }, { JWT_SECRET: secret });
  const adminController = load("controllers/adminController.js", { "../models/Admin": Admin, bcryptjs: bcrypt, jsonwebtoken: jwt }, { JWT_SECRET: secret });
  const inventoryController = load("controllers/inventoryController.js", {
    "../models/Inventory": Inventory, "node:crypto": require("node:crypto"), "../services/pricing": require("../../services/pricing"),
  }, {});
  const router = load("routes/adminRoutes.js", {
    express, "../middleware/auth": auth, "../controllers/adminController": adminController,
    "../controllers/inventoryController": inventoryController,
    "../controllers/adminOrderController": { getAdminOrders() {}, getAdminOrder() {}, updateFulfillment() {} },
    "../controllers/adminVerificationController": {
      requestEmailVerification: (req, res) => verification.requestEmailVerification(req, res),
      verifyAdminEmail: (req, res) => verification.verifyAdminEmail(req, res),
    },
  }, {});
  const app = express(); app.use(require("cors")()); app.use(express.json()); app.use("/api/admin", router);
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  const tokens = {};
  async function reset() {
    await Promise.all([Admin.deleteMany({}), User.deleteMany({}), Inventory.deleteMany({}), Delivery.deleteMany({})]);
    clock = Date.now(); messages = [];
    mailBehavior = async message => ({ accepted: [message.to], rejected: [] });
    verification = createAdminVerificationController(dependencies);
    admin = await Admin.create({ email: "admin@example.test", password: passwordHash });
    other = await Admin.create({ email: "other@example.test", password: passwordHash });
    user = await User.create({ name: "Fixture user", email: "user@example.test", password: passwordHash, isVerified: true });
    tokens.admin = jwt.sign({ role: "admin" }, secret, { algorithm: "HS256", subject: String(admin._id), expiresIn: "1h" });
    tokens.other = jwt.sign({ role: "admin" }, secret, { algorithm: "HS256", subject: String(other._id), expiresIn: "1h" });
    tokens.user = jwt.sign({ role: "user" }, secret, { algorithm: "HS256", subject: String(user._id), expiresIn: "1h" });
  }
  async function request(method, endpoint, role, body) {
    const headers = {};
    if (role) headers.Authorization = `Bearer ${tokens[role]}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${origin}/api/admin${endpoint}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual",
    });
    const text = await response.text();
    return { status: response.status, location: response.headers.get("location"), retry: response.headers.get("retry-after"), body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null };
  }
  const send = role => request("POST", "/request-email-verification", role || "admin");
  const linkToken = message => message.text.match(/\/api\/admin\/verify-email\/([a-f\d]{64})/)[1];
  const verify = token => request("GET", `/verify-email/${token}`);
  const rawAccount = () => Admin.collection.findOne({ _id: admin._id });

  await t.test("only a signed-in admin can request their own stored email; unverified login still works", async () => {
    await reset();
    assert.equal((await request("POST", "/request-email-verification")).status, 401);
    assert.equal((await send("user")).status, 403);
    for (const body of [{ email: other.email }, { role: "user" }, { isVerified: true }, { token: "chosen" }]) {
      assert.equal((await request("POST", "/request-email-verification", "admin", body)).status, 400);
    }
    assert.equal(messages.length, 0);
    const login = await request("POST", "/login", undefined, { email: admin.email, password: fixturePassword });
    assert.equal(login.status, 200); assert.equal(login.body.admin.isVerified, false);
    assert.equal(jwt.verify(login.body.token, secret).role, "admin");
    const result = await send();
    assert.equal(result.status, 202); assert.equal(result.body.isVerified, false);
    assert.equal(messages.length, 1); assert.equal(messages[0].to, admin.email);
    const token = linkToken(messages[0]);
    const stored = await rawAccount();
    assert.ok(stored.emailVerification.hash === hashToken(token));
    assert.ok(stored.emailVerification.hash !== token);
    assert.equal(stored.emailVerification.expiresAt.getTime(), clock + LINK_LIFETIME_MS);
    assert.equal(stored.pendingEmailVerification, undefined);
    assert.equal(stored.verificationSendLockUntil, undefined);
    assert.ok(!JSON.stringify(result.body).includes(token));
    assert.equal((await Admin.findById(other._id)).isVerified, false);
    const profile = (await request("GET", "/me", "admin")).body.admin;
    assert.deepEqual(Object.keys(profile).sort(), ["email", "id", "isVerified", "role"]);
    assert.ok(!JSON.stringify(profile).includes(token));
    assert.equal((await send()).status, 429); assert.equal(messages.length, 1);
  });

  await t.test("link verifies only its account once, preserves password/role and enables real alert filtering", async () => {
    await reset();
    await Inventory.create({ name: "Classic Thin", category: "base", stock: 0, threshold: 0 });
    const checkerMessages = [];
    const checker = createLowStockChecker({ inventory: Inventory, admins: Admin, deliveries: Delivery, logger,
      mail: async message => { checkerMessages.push(message); return { accepted: [message.to] }; },
    });
    assert.equal((await checker()).recipients, 0);
    const before = await rawAccount();
    const order = await connection.collection("orders").insertOne({ status: "pending_payment", paymentStatus: "pending", currency: "EUR", totalMinor: 600 });
    const beforeOrder = await connection.collection("orders").findOne({ _id: order.insertedId });
    await send(); const token = linkToken(messages[0]);
    assert.equal((await verify(token)).location, `${clientOrigin}/admin/login?verification=success`);
    const after = await rawAccount();
    assert.equal(after.isVerified, true);
    for (const field of ["_id", "email", "password", "createdAt"]) assert.deepEqual(after[field], before[field]);
    for (const field of ["emailVerification", "pendingEmailVerification", "verificationEmailSentAt", "verificationSendLockUntil"]) assert.equal(after[field], undefined);
    assert.equal((await Admin.findById(other._id)).isVerified, false);
    const profile = (await request("GET", "/me", "admin")).body.admin;
    assert.equal(profile.role, "admin"); assert.equal(profile.isVerified, true);
    assert.equal((await verify(token)).location, `${clientOrigin}/admin/login?verification=invalid`);
    assert.equal((await send()).body.isVerified, true); assert.equal(messages.length, 1);
    assert.equal((await checker()).sent, 1); assert.equal(checkerMessages[0].to, admin.email);
    assert.equal((await Inventory.findOne()).stock, 0);
    assert.deepEqual(await connection.collection("orders").findOne({ _id: order.insertedId }), beforeOrder);
    const login = await request("POST", "/login", undefined, { email: admin.email, password: fixturePassword });
    assert.equal(login.status, 200); assert.equal(login.body.admin.isVerified, true);
  });

  await t.test("existing legacy admin without a verification field can complete the same flow", async () => {
    await reset();
    await Admin.collection.updateOne({ _id: admin._id }, { $unset: { isVerified: 1 } });
    const login = await request("POST", "/login", undefined, { email: admin.email, password: fixturePassword });
    assert.equal(login.status, 200); assert.equal(login.body.admin.isVerified, false);
    assert.equal((await send()).status, 202);
    assert.equal((await verify(linkToken(messages[0]))).location, `${clientOrigin}/admin/login?verification=success`);
    assert.equal((await request("GET", "/me", "admin")).body.admin.isVerified, true);
  });

  await t.test("expiration boundary, arbitrary tokens and replacement links are enforced after restart", async () => {
    await reset(); await send(); const expired = linkToken(messages[0]);
    clock += LINK_LIFETIME_MS;
    assert.equal((await verify(expired)).location, `${clientOrigin}/admin/login?verification=invalid`);
    assert.equal((await Admin.findById(admin._id)).isVerified, false);
    assert.equal((await verify("f".repeat(64))).location, `${clientOrigin}/admin/login?verification=invalid`);
    assert.equal((await verify("invalid")).location, `${clientOrigin}/admin/login?verification=invalid`);
    await send(); const replacement = linkToken(messages[1]);
    assert.ok(replacement !== expired);
    verification = createAdminVerificationController(dependencies);
    assert.equal((await verify(replacement)).location, `${clientOrigin}/admin/login?verification=success`);
  });

  await t.test("SMTP failure/rejection preserves the previous link and permits an immediate retry", async () => {
    for (const failingMail of [async () => { throw new Error("private SMTP fixture detail"); }, async () => ({ accepted: [], rejected: [admin.email] }), async () => ({})]) {
      await reset(); await send(); const original = linkToken(messages[0]);
      clock += 61000;
      mailBehavior = failingMail;
      const failed = await send();
      assert.equal(failed.status, 503);
      assert.ok(!JSON.stringify(failed.body).includes("private"));
      const stored = await rawAccount();
      assert.ok(stored.emailVerification.hash === hashToken(original));
      assert.equal(stored.pendingEmailVerification, undefined);
      assert.equal(stored.verificationSendLockUntil, undefined);
      assert.equal(stored.isVerified, false);
      mailBehavior = async message => ({ accepted: [message.to] });
      assert.equal((await send()).status, 202);
      const replacement = linkToken(messages.at(-1));
      assert.equal((await verify(original)).location, `${clientOrigin}/admin/login?verification=invalid`);
      assert.equal((await verify(replacement)).location, `${clientOrigin}/admin/login?verification=success`);
    }
  });

  await t.test("a failed resend leaves the earlier accepted link usable", async () => {
    await reset(); await send(); const original = linkToken(messages[0]); clock += 61000;
    mailBehavior = async () => { throw new Error("SMTP fixture failure"); };
    assert.equal((await send()).status, 503);
    assert.equal((await verify(original)).location, `${clientOrigin}/admin/login?verification=success`);
  });

  await t.test("simultaneous/restarted requests use a persisted send lock; pending links can be consumed safely", async () => {
    await reset();
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    mailBehavior = async message => { entered(); await gate; return { accepted: [message.to] }; };
    const first = send();
    try {
      await started;
      assert.equal((await rawAccount()).verificationEmailSentAt, undefined);
      verification = createAdminVerificationController(dependencies);
      assert.equal((await send()).status, 409); assert.equal(messages.length, 1);
      const token = linkToken(messages[0]);
      assert.equal((await verify(token)).location, `${clientOrigin}/admin/login?verification=success`);
      release();
      assert.equal((await first).body.isVerified, true);
      const stored = await rawAccount();
      assert.equal(stored.isVerified, true);
      assert.equal(stored.emailVerification, undefined);
      assert.equal(stored.pendingEmailVerification, undefined);
      assert.equal(stored.verificationEmailSentAt, undefined);
    } finally { release(); await first; }
  });

  await t.test("crashed SMTP cleanup locks expire and a new request can recover", async () => {
    await reset();
    verification = createAdminVerificationController({ ...dependencies, admins: {
      findOneAndUpdate: (...args) => Admin.findOneAndUpdate(...args),
      updateOne: async () => { throw new Error("Fixture cleanup unavailable"); },
      findById: (...args) => Admin.findById(...args),
    } });
    mailBehavior = async () => { throw new Error("SMTP fixture failure"); };
    assert.equal((await send()).status, 503);
    verification = createAdminVerificationController(dependencies);
    assert.equal((await send()).status, 409);
    clock += 91000; mailBehavior = async message => ({ accepted: [message.to] });
    assert.equal((await send()).status, 202);
    assert.equal((await verify(linkToken(messages.at(-1)))).location, `${clientOrigin}/admin/login?verification=success`);
  });

  await t.test("an accepted email remains usable if final delivery recording fails", async () => {
    await reset();
    verification = createAdminVerificationController({ ...dependencies, admins: {
      findOneAndUpdate: (...args) => Admin.findOneAndUpdate(...args),
      updateOne: async () => { throw new Error("Fixture delivery recording unavailable"); },
      findById: (...args) => Admin.findById(...args),
    } });
    assert.equal((await send()).status, 503);
    assert.equal((await rawAccount()).verificationEmailSentAt, undefined);
    verification = createAdminVerificationController(dependencies);
    assert.equal((await verify(linkToken(messages[0]))).location, `${clientOrigin}/admin/login?verification=success`);
    assert.equal((await Admin.findById(admin._id)).isVerified, true);
  });

  await t.test("verification binds to the unchanged email and never consumes user tokens", async () => {
    await reset(); await send(); const token = linkToken(messages[0]);
    await Admin.updateOne({ _id: admin._id }, { $set: { email: "changed@example.test" } });
    assert.equal((await verify(token)).location, `${clientOrigin}/admin/login?verification=invalid`);
    assert.equal((await Admin.findById(admin._id)).isVerified, false);
    await User.updateOne({ _id: user._id }, { $set: { verificationToken: token } });
    assert.equal((await verify(token)).location, `${clientOrigin}/admin/login?verification=invalid`);
    assert.equal((await User.findById(user._id)).verificationToken, token);
  });
});
