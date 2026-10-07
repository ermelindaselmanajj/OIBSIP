const test = require("node:test");
const assert = require("node:assert/strict");
const Admin = require("../models/Admin");
const { createAdminVerificationController, hashToken, LINK_LIFETIME_MS } = require("../controllers/adminVerificationController");

const identity = { _id: "222222222222222222222222", email: "admin@example.test", isVerified: false };
const urls = { clientUrl: () => "https://client.example.test", serverUrl: () => "https://api.example.test" };
function response() {
  return { statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, redirect(url) { this.statusCode = 302; this.location = url; return this; } };
}

test("admin verification stores hashes privately and uses a 30-minute lifetime", async () => {
  const token = "a".repeat(64);
  const hash = hashToken(token);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, token);
  assert.equal(hashToken(token), hash);
  assert.equal(LINK_LIFETIME_MS, 30 * 60 * 1000);
  for (const field of ["emailVerification", "pendingEmailVerification", "verificationEmailSentAt", "verificationSendLockUntil"]) {
    assert.equal(Admin.schema.path(field).options.select, false);
  }
  await assert.rejects(new Admin({ ...identity, password: "fixture-hash", emailVerification: { hash } }).validate());
});

test("verified administrator requests return success without sending or changing an account", async () => {
  const controller = createAdminVerificationController({ admins: {}, mail: async () => assert.fail("No SMTP call expected") });
  const res = response();
  await controller.requestEmailVerification({ identity: { ...identity, isVerified: true } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.isVerified, true);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("verification requests cannot supply another account, role, token or arbitrary body", async () => {
  const controller = createAdminVerificationController({ admins: {}, mail: async () => assert.fail("No SMTP call expected") });
  for (const body of [null, [], "email", { email: "other@example.test" }, { isVerified: true }, { role: "user" }, { token: "chosen" }]) {
    const res = response();
    await controller.requestEmailVerification({ identity, body }, res);
    assert.equal(res.statusCode, 400);
  }
  const res = response();
  await controller.requestEmailVerification({ identity: { ...identity, email: "bad,address@example.test" } }, res);
  assert.equal(res.statusCode, 400);
});

test("malformed links do not query MongoDB and redirect without leaking the token", async () => {
  const controller = createAdminVerificationController({ admins: {}, urls });
  for (const token of [undefined, "invalid", "a".repeat(63), "a".repeat(65), { $ne: "" }]) {
    const res = response();
    await controller.verifyAdminEmail({ params: { token } }, res);
    assert.equal(res.location, "https://client.example.test/admin/login?verification=invalid");
    assert.equal(res.headers["Referrer-Policy"], "no-referrer");
    assert.equal(res.headers["Cache-Control"], "no-store");
  }
});

test("database errors and configuration errors are reported without secrets or verification links", async () => {
  const logs = [];
  const controller = createAdminVerificationController({
    admins: { findOneAndUpdate: async () => { throw new Error("private database detail"); } },
    urls, logger: { error: message => logs.push(message) },
  });
  const request = response();
  await controller.requestEmailVerification({ identity }, request);
  assert.equal(request.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(request.body) + logs.join(" "), /private|https:\/\/api/);
  const verify = response();
  await controller.verifyAdminEmail({ params: { token: "a".repeat(64) } }, verify);
  assert.equal(verify.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(verify.body), /private|a{64}/);
});
