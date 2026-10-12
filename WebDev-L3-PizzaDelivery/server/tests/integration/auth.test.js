const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const express = require("express");
const { seedPizzas, pizzas } = require("../../seedPizzas");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

test("user authentication and menu seeding with isolated MongoDB and simulated SMTP", { timeout: 120000 }, async t => {
  assert.ok(process.env.MONGO_URI, "Existing MongoDB configuration is required; credentials are never displayed.");
  const dbName = `pizza_final_auth_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const connection = mongoose.createConnection();
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    try {
      if (connection.readyState === 1) {
        assert.equal(connection.name, dbName);
        assert.ok(connection.name.startsWith("pizza_final_auth_test_"));
        await connection.dropDatabase();
        t.diagnostic("Isolated authentication database dropped. All SMTP was simulated.");
      }
    } finally { await connection.close(); }
  });
  try { await connection.openUri(process.env.MONGO_URI, { dbName, serverSelectionTimeoutMS: 10000 }); }
  catch { assert.fail("Could not connect to the isolated test database; check access privately."); }
  const User = connection.model("User", require("../../models/User").schema);
  const Admin = connection.model("Admin", require("../../models/Admin").schema);
  const Pizza = connection.model("Pizza", require("../../models/Pizza").schema);
  await Promise.all([User.init(), Admin.init(), Pizza.init()]);
  const secret = "isolated-final-review-jwt-secret";
  const env = { JWT_SECRET: secret };
  const mails = [], logs = [];
  let mailFails = false;
  function load(file, dependencies) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8"), {
      module, process: { env }, console: { error: (...args) => logs.push(args) },
      require(name) {
        if (Object.hasOwn(dependencies, name)) return dependencies[name];
        if (["bcryptjs", "jsonwebtoken", "crypto", "node:buffer"].includes(name)) return require(name);
        throw new Error("Unexpected isolated dependency");
      },
    });
    return module.exports;
  }
  const auth = load("middleware/auth.js", { "../models/User": User, "../models/Admin": Admin });
  const controllers = load("controllers/authController.js", {
    "../models/User": User,
    "../config/urls": { clientUrl: () => "http://client.example.test", serverUrl: () => "http://server.example.test" },
    "../utils/sendEmail": async mail => {
      mails.push(mail);
      if (mailFails) throw new Error("Private SMTP details must not be logged");
      return { accepted: [mail.to], rejected: [] };
    },
  });
  const routes = load("routes/authRoutes.js", { express, "../controllers/authController": controllers, "../middleware/auth": auth });
  const app = express(); app.use(express.json()); app.use("/api/auth", routes);
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  const origin = `http://127.0.0.1:${server.address().port}/api/auth`;
  async function request(endpoint, body, bearer) {
    const response = await fetch(origin + endpoint, {
      method: body === undefined ? "GET" : "POST", redirect: "manual",
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, location: response.headers.get("location"),
      body: response.headers.get("content-type")?.includes("json") ? await response.json() : null };
  }
  const account = { name: "Fixture owner", email: "owner@example.test", password: randomUUID() };
  let user;

  await t.test("registration delivery failure is retryable, email verification enables JWT login, and public roles are ignored", async () => {
    mailFails = true;
    assert.equal((await request("/register", { ...account, role: "admin", isVerified: true })).status, 503);
    user = await User.findOne({ email: account.email });
    const originalId = String(user._id), originalPassword = user.password;
    assert.equal(user.isVerified, false); assert.ok(await bcrypt.compare(account.password, user.password));
    assert.equal(await Admin.countDocuments(), 0);
    assert.equal((await request("/login", account)).status, 401);
    assert.equal((await request("/register", { ...account, password: "wrong" })).status, 400);
    mailFails = false;
    assert.equal((await request("/register", { ...account, name: "Replacement" })).status, 201);
    user = await User.findOne({ email: account.email });
    assert.equal(String(user._id), originalId); assert.equal(user.name, account.name); assert.equal(user.password, originalPassword);
    assert.ok(mails.at(-1).html.includes(`http://server.example.test/api/auth/verify-email/${user.verificationToken}`));
    const verificationToken = user.verificationToken;
    assert.equal((await request(`/verify-email/${verificationToken}`)).location, "http://client.example.test/login?verified=true");
    assert.equal((await request(`/verify-email/${verificationToken}`)).status, 400);
    const login = await request("/login", account);
    assert.equal(login.status, 200); assert.equal(jwt.verify(login.body.token, secret).role, "user");
    assert.equal((await request("/me", undefined, login.body.token)).status, 200);
    assert.equal((await request("/me")).status, 401);
    assert.equal(logs.every(args => args.length === 1 && typeof args[0] === "string" && !args[0].includes("Private SMTP")), true);
  });

  await t.test("reset delivery failures preserve old links, and malformed inputs cannot send email", async () => {
    const sent = mails.length;
    for (const email of [{ $ne: null }, "invalid", "a@example.test,b@example.test"]) {
      assert.equal((await request("/forgot-password", { email })).status, 400);
    }
    assert.equal(mails.length, sent);
    const oldExpiry = new Date(Date.now() + 30000);
    await User.updateOne({ _id: user._id }, { $set: { resetPasswordToken: "old-fixture-link", resetPasswordExpires: oldExpiry } });
    mailFails = true;
    assert.equal((await request("/forgot-password", { email: account.email })).status, 503);
    const after = await User.findById(user._id);
    assert.equal(after.resetPasswordToken, "old-fixture-link"); assert.equal(after.resetPasswordExpires.getTime(), oldExpiry.getTime());
    mailFails = false;
  });

  await t.test("real concurrent reset requests consume one expiring link exactly once", async () => {
    assert.equal((await request("/forgot-password", { email: account.email })).status, 200);
    const pending = await User.findById(user._id);
    assert.ok(mails.at(-1).html.includes(`http://client.example.test/reset-password/${pending.resetPasswordToken}`));
    for (const password of [[], 123, "é".repeat(37)]) assert.equal((await request(`/reset-password/${pending.resetPasswordToken}`, { password })).status, 400);
    const passwords = [randomUUID(), randomUUID(), randomUUID()];
    const responses = await Promise.all(passwords.map(password => request(`/reset-password/${pending.resetPasswordToken}`, { password })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 400, 400]);
    const saved = await User.findById(user._id);
    assert.ok(await bcrypt.compare(passwords[responses.findIndex(response => response.status === 200)], saved.password));
    assert.equal(saved.resetPasswordToken, undefined); assert.equal(saved.resetPasswordExpires, undefined);
    assert.equal((await request(`/reset-password/${pending.resetPasswordToken}`, { password: randomUUID() })).status, 400);
    await User.updateOne({ _id: user._id }, { $set: { resetPasswordToken: "expired-fixture", resetPasswordExpires: new Date(Date.now() - 1) } });
    assert.equal((await request("/reset-password/expired-fixture", { password: randomUUID() })).status, 400);
    assert.equal((await User.findById(user._id)).password, saved.password);
  });

  await t.test("menu setup preserves an existing record and repeated seeding does not duplicate pizzas", async () => {
    const original = await Pizza.create({ ...pizzas[0], price: 12.75, image: "preserved-photo.jpg" });
    const db = { connect: async () => { assert.equal(connection.name, dbName); }, disconnect: async () => {} };
    await seedPizzas({ mongoose: db, Pizza });
    const once = await Pizza.find().sort({ _id: 1 }).lean();
    await seedPizzas({ mongoose: db, Pizza });
    assert.deepEqual(await Pizza.find().sort({ _id: 1 }).lean(), once);
    assert.equal(await Pizza.countDocuments(), 6);
    assert.equal((await Pizza.findById(original._id)).price, 12.75);
    assert.equal((await Pizza.findById(original._id)).image, "preserved-photo.jpg");
  });
});
