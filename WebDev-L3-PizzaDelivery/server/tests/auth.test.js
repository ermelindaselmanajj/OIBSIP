const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness({ user = null, mailFails = false, env = {}, createFails = false, mailGate } = {}) {
  const state = { user, mails: [], saves: 0, hashes: 0, creates: 0, queries: [] };
  const attach = (value) => {
    if (value) value.save = async () => { state.saves++; };
    return value;
  };
  attach(user);
  const User = {
    findOne: async (query) => { state.queries.push(query); return state.user; },
    create: async (value) => {
      state.creates++;
      if (createFails) throw new Error('DB unavailable');
      state.user = attach(value);
      return state.user;
    },
  };
  const urlsModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../config/urls.js'), 'utf8'), {
    module: urlsModule, process: { env }, URL,
  });
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/authController.js'), 'utf8'), {
    module, process: { env }, console: { error() {} },
    require: (name) => {
      if (name === '../models/User') return User;
      if (name === 'bcryptjs') return {
        hash: async (password) => { state.hashes++; return `hashed:${password}`; },
        compare: async (password, hash) => hash === `hashed:${password}`,
      };
      if (name === 'jsonwebtoken') return { sign: () => 'jwt' };
      if (name === 'crypto') return require('node:crypto');
      if (name === '../config/urls') return urlsModule.exports;
      if (name === '../utils/sendEmail') return async (mail) => {
        state.mails.push(mail);
        if (mailGate) await mailGate;
        if (state.mailFails) throw new Error('SMTP unavailable');
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  state.mailFails = mailFails;
  const invoke = async (handler, body = {}, params = {}) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
      redirect(url) { this.redirectUrl = url; return this; },
    };
    await module.exports[handler]({ body, params }, res);
    return res;
  };
  return { state, invoke, urls: urlsModule.exports };
}
const registration = { name: 'Original', email: 'person@example.test', password: 'secret' };

test('registration waits for email and uses configured server URL', async () => {
  const { state, invoke } = harness({ env: { SERVER_URL: 'https://api.example.test///' } });
  const res = await invoke('registerUser', registration);
  assert.equal(res.statusCode, 201);
  assert.equal(state.creates, 1);
  assert.equal(state.user.password, 'hashed:secret');
  assert.match(state.mails[0].html, new RegExp(`https://api.example.test/api/auth/verify-email/${state.user.verificationToken}`));
});

test('failed verification delivery returns 503 and same-password retry preserves account', async () => {
  const { state, invoke } = harness({ mailFails: true });
  assert.equal((await invoke('registerUser', registration)).statusCode, 503);
  const token = state.user.verificationToken;
  state.mailFails = false;
  const res = await invoke('registerUser', { ...registration, name: 'Replacement' });
  assert.equal(res.statusCode, 201);
  assert.equal(state.user.name, 'Original');
  assert.equal(state.user.password, 'hashed:secret');
  assert.equal(state.user.verificationToken, token);
  assert.equal(state.creates, 1);
  assert.equal(state.hashes, 1);
});

test('wrong-password retry and verified duplicate cannot send or change account', async () => {
  for (const isVerified of [false, true]) {
    const { state, invoke } = harness({ user: { ...registration, password: 'hashed:secret', isVerified, verificationToken: 'existing' } });
    const res = await invoke('registerUser', { ...registration, password: isVerified ? 'secret' : 'wrong' });
    assert.equal(res.statusCode, 400);
    assert.equal(state.mails.length, 0);
    assert.equal(state.saves, 0);
    assert.equal(state.hashes, 0);
  }
});

test('unverified account lacking token receives persisted token on retry', async () => {
  const { state, invoke } = harness({ user: { ...registration, password: 'hashed:secret', isVerified: false } });
  assert.equal((await invoke('registerUser', registration)).statusCode, 201);
  assert.ok(state.user.verificationToken);
  assert.equal(state.saves, 1);
});

test('verification clears token and redirects to configured client', async () => {
  const { state, invoke } = harness({ user: { verificationToken: 'valid' }, env: { CLIENT_URL: 'https://pizza.example.test/' } });
  const res = await invoke('verifyEmail', {}, { token: 'valid' });
  assert.equal(res.redirectUrl, 'https://pizza.example.test/login?verified=true');
  assert.equal(state.user.isVerified, true);
  assert.equal(state.user.verificationToken, undefined);
});

test('invalid verification and reset tokens are rejected', async () => {
  const { invoke } = harness();
  assert.equal((await invoke('verifyEmail', {}, { token: 'invalid' })).statusCode, 400);
  assert.equal((await invoke('resetPassword', { password: 'new' }, { token: 'expired' })).statusCode, 400);
});

test('reset delivery failure preserves old token and expiry without DB write', async () => {
  const expiry = new Date(Date.now() + 100000);
  const { state, invoke } = harness({ user: { email: registration.email, resetPasswordToken: 'old', resetPasswordExpires: expiry }, mailFails: true });
  const res = await invoke('forgotPassword', { email: registration.email });
  assert.equal(res.statusCode, 503);
  assert.equal(state.user.resetPasswordToken, 'old');
  assert.equal(state.user.resetPasswordExpires, expiry);
  assert.equal(state.saves, 0);
});

test('successful reset email saves matching token and 15-minute expiry', async () => {
  const { state, invoke } = harness({ user: { email: registration.email }, env: { CLIENT_URL: 'https://pizza.example.test///' } });
  const before = Date.now();
  const res = await invoke('forgotPassword', { email: registration.email });
  assert.equal(res.statusCode, 200);
  assert.equal(state.saves, 1);
  assert.match(state.mails[0].html, new RegExp(`https://pizza.example.test/reset-password/${state.user.resetPasswordToken}`));
  assert.ok(state.user.resetPasswordExpires >= before + 15 * 60 * 1000);
  assert.ok(state.user.resetPasswordExpires <= Date.now() + 15 * 60 * 1000);
});

test('reset consumes token and hashes new password; expiry included in query', async () => {
  const { state, invoke } = harness({ user: { password: 'hashed:old', resetPasswordToken: 'valid' } });
  assert.equal((await invoke('resetPassword', { password: 'new' }, { token: 'valid' })).statusCode, 200);
  assert.equal(state.user.password, 'hashed:new');
  assert.equal(state.user.resetPasswordToken, undefined);
  assert.equal(state.user.resetPasswordExpires, undefined);
  assert.equal(state.queries[0].resetPasswordToken, 'valid');
  assert.ok(state.queries[0].resetPasswordExpires.$gt > 0);
});

test('URL defaults and configurable PORT remain consistent', () => {
  const defaults = harness().urls;
  assert.equal(defaults.clientUrl(), 'http://localhost:5173');
  assert.equal(defaults.serverUrl(), 'http://localhost:5001');
  assert.equal(harness({ env: { PORT: '6000' } }).urls.serverUrl(), 'http://localhost:6000');
});

test('DB failure remains a server error rather than success or SMTP error', async () => {
  const { state, invoke } = harness({ createFails: true });
  assert.equal((await invoke('registerUser', registration)).statusCode, 500);
  assert.equal(state.mails.length, 0);
});


test('registration and reset responses wait until SMTP resolves', async () => {
  for (const handler of ['registerUser', 'forgotPassword']) {
    let release;
    const mailGate = new Promise(resolve => { release = resolve; });
    const { state, invoke } = harness({ mailGate, user: handler === 'forgotPassword' ? { email: registration.email } : null });
    let finished = false;
    const pending = invoke(handler, registration).then(res => { finished = true; return res; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.mails.length, 1);
    assert.equal(finished, false);
    release();
    assert.ok([200, 201].includes((await pending).statusCode));
  }
});

test('URL config rejects credentials, paths, and non-HTTP protocols without exposing values', () => {
  for (const value of ['ftp://private.example', 'https://user:secret@example.test', 'https://example.test/subpath', 'not-a-url']) {
    assert.throws(() => harness({ env: { CLIENT_URL: value } }).urls.clientUrl(), {
      message: 'CLIENT_URL must be a valid HTTP(S) origin',
    });
  }
});
