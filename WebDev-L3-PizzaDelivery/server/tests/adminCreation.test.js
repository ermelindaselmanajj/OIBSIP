const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createAdmin, loadConfiguration, safeDatabaseError } = require("../scripts/createAdmin");

test("admin configuration loads server/.env by absolute path without replacing exported values", () => {
  const env = { MONGO_URI: "mongodb://example.invalid/test" };
  loadConfiguration({ env, config(options) {
    assert.equal(options.path, path.resolve(__dirname, "../.env"));
    assert.equal(options.quiet, true);
    assert.equal(options.processEnv, env);
    return {};
  } });
  assert.equal(env.MONGO_URI, "mongodb://example.invalid/test");
});

test("configuration distinguishes missing, unreadable and invalid URI without exposing values", () => {
  assert.throws(() => loadConfiguration({ env: {}, config: () => ({ error: { code: "ENOENT" } }) }), { code: "MONGO_URI_MISSING" });
  assert.throws(() => loadConfiguration({ env: {}, config: () => ({ error: { code: "EACCES" } }) }), { code: "ENV_READ_FAILED" });
  assert.throws(() => loadConfiguration({ env: { MONGO_URI: "private-invalid-value" }, config: () => ({}) }), error => {
    assert.equal(error.code, "MONGO_URI_INVALID");
    assert.ok(!error.message.includes("private-invalid-value"));
    return true;
  });
});

test("input errors identify email, short password and UTF-8 byte limit before DB access", async () => {
  const cases = [
    [{ email: "invalid", password: "a".repeat(12) }, "INVALID_EMAIL"],
    [{ email: "a@example.test", password: "a".repeat(11) }, "PASSWORD_TOO_SHORT"],
    [{ email: "a@example.test", password: "é".repeat(37) }, "PASSWORD_TOO_LONG"],
  ];
  for (const [input, code] of cases) await assert.rejects(createAdmin(input, {}), { code });
});

test("driver diagnostics have specific fixed messages and never include raw credentials or URI", () => {
  const privateDetail = "mongodb://fixture-user:fixture-password@example.invalid/test";
  const cases = [
    [{ code: 18, message: privateDetail }, "MONGO_AUTH_FAILED"],
    [{ errorResponse: { code: 13 }, message: privateDetail }, "MONGO_PERMISSION_DENIED"],
    [{ code: 11000, message: privateDetail }, "ADMIN_EXISTS"],
    [{ name: "MongoParseError", message: privateDetail }, "MONGO_URI_INVALID"],
    [{ message: "querySrv ENOTFOUND " + privateDetail }, "MONGO_DNS_FAILED"],
    [{ message: "ECONNREFUSED " + privateDetail }, "MONGO_NETWORK_FAILED"],
    [{ name: "MongooseServerSelectionError", reason: { servers: new Map([["private-host", { error: { code: 18 } }]]) } }, "MONGO_AUTH_FAILED"],
    [{ message: "ETIMEDOUT " + privateDetail }, "MONGO_TIMEOUT"],
    [{ message: "TLS certificate error " + privateDetail }, "MONGO_TLS_FAILED"],
  ];
  for (const [error, expected] of cases) {
    const result = safeDatabaseError(error, "connect");
    assert.equal(result.code, expected);
    assert.ok(!result.message.includes(privateDetail));
    assert.ok(!result.message.includes("fixture-password"));
    assert.ok(!result.message.includes("private-host"));
  }
});

function dependencies({ exists = false, connectError, lookupError, hashError, saveError, disconnectError } = {}) {
  const state = { writes: 0, hashes: 0, disconnects: 0 };
  return { state, deps: {
    mongoose: {
      connect: async (_uri, options) => {
        assert.equal(options.serverSelectionTimeoutMS, 10000);
        if (connectError) throw connectError;
      },
      disconnect: async () => { state.disconnects++; if (disconnectError) throw disconnectError; },
    },
    bcrypt: { hash: async () => { state.hashes++; if (hashError) throw hashError; return "hashed-fixture"; } },
    Admin: {
      findOne: async () => { if (lookupError) throw lookupError; return exists ? {} : null; },
      create: async () => { if (saveError) throw saveError; state.writes++; },
    },
  } };
}
const input = { email: "a@example.test", password: "fixture-input-only" };

test("existing administrator is specifically reported without hashing or overwriting", async () => {
  const { state, deps } = dependencies({ exists: true });
  await assert.rejects(createAdmin(input, deps), { code: "ADMIN_EXISTS" });
  assert.equal(state.writes, 0);
  assert.equal(state.hashes, 0);
  assert.equal(state.disconnects, 1);
});

test("primary connection error is retained if cleanup also fails", async () => {
  const { state, deps } = dependencies({ connectError: { code: 18 }, disconnectError: new Error("private cleanup detail") });
  await assert.rejects(createAdmin(input, deps), { code: "MONGO_AUTH_FAILED" });
  assert.equal(state.writes, 0);
  assert.equal(state.disconnects, 1);
});

test("lookup, hashing, save and racing duplicate failures are distinguished", async () => {
  for (const [options, code] of [
    [{ lookupError: new Error("private") }, "ADMIN_LOOKUP_FAILED"],
    [{ hashError: new Error("private") }, "PASSWORD_HASH_FAILED"],
    [{ saveError: new Error("private") }, "ADMIN_SAVE_FAILED"],
    [{ saveError: { code: 11000, message: "private duplicate value" } }, "ADMIN_EXISTS"],
  ]) {
    const { state, deps } = dependencies(options);
    await assert.rejects(createAdmin(input, deps), { code });
    assert.equal(state.writes, 0);
    assert.equal(state.disconnects, 1);
  }
});

test("cleanup failure after creation explicitly reports that the account was created", async () => {
  const { state, deps } = dependencies({ disconnectError: new Error("private") });
  await assert.rejects(createAdmin(input, deps), error => {
    assert.equal(error.code, "DISCONNECT_FAILED");
    assert.match(error.message, /Administrator was created/);
    return true;
  });
  assert.equal(state.writes, 1);
});
