const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createAdmin } = require('../scripts/createAdmin');
const secret = 'offline-test-secret-only-not-for-deployment';
const userId = '111111111111111111111111';
const adminId = '222222222222222222222222';

function load(file, dependencies, env = { JWT_SECRET: secret }) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    module, process: { env }, console: { error() {} },
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (['jsonwebtoken', 'bcryptjs', 'crypto'].includes(name)) return require(name);
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return module.exports;
}
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function middleware({ user = { _id: userId, isVerified: true }, admin = { _id: adminId }, failDB = false } = {}) {
  const lookups = [];
  return {
    lookups,
    ...load('middleware/auth.js', {
      '../models/User': { findById: async (id) => { lookups.push(['user', id]); if (failDB) throw new Error('private DB info'); return user; } },
      '../models/Admin': { findById: async (id) => { lookups.push(['admin', id]); if (failDB) throw new Error('private DB info'); return admin; } },
    }),
  };
}
function token(role = 'user', options = {}) {
  return jwt.sign({ role }, secret, { subject: role === 'admin' ? adminId : userId, expiresIn: '1d', algorithm: 'HS256', ...options });
}
async function authorize(required, bearer, identities) {
  const { requireRole, lookups } = middleware(identities);
  const req = { headers: bearer === undefined ? {} : { authorization: bearer } };
  const res = response();
  let next = false;
  await requireRole(required)(req, res, () => { next = true; });
  return { req, res, next, lookups };
}

test('real JWT authenticates users and admins against their separate collections', async () => {
  for (const role of ['user', 'admin']) {
    const result = await authorize(role, `Bearer ${token(role)}`);
    assert.equal(result.next, true);
    assert.equal(result.req.authRole, role);
    assert.equal(result.lookups[0][0], role);
  }
});

test('missing, malformed, expired, tampered and wrong-secret tokens return 401', async () => {
  const valid = token();
  const [header, payload, signature] = valid.split('.');
  const tamperedPayload = Buffer.from(JSON.stringify({ ...jwt.decode(valid), role: 'admin' })).toString('base64url');
  const invalid = [undefined, 'Basic secret', 'Bearer', 'Bearer a b', 'Bearer garbage',
    `Bearer ${token('user', { expiresIn: -1 })}`,
    `Bearer ${header}.${tamperedPayload}.${signature}`,
    `Bearer ${jwt.sign({ role: 'user' }, 'other-secret', { subject: userId, expiresIn: '1d' })}`];
  for (const bearer of invalid) {
    const result = await authorize('user', bearer);
    assert.equal(result.res.statusCode, 401);
    assert.equal(result.next, false);
    assert.equal(result.lookups.length, 0);
  }
});

test('legacy tokens and missing/invalid role, subject or expiry are rejected', async () => {
  const claims = [
    { userId }, { role: 'user', sub: userId },
    { role: 'owner', sub: userId, exp: Math.floor(Date.now() / 1000) + 100 },
    { role: 'user', sub: 'invalid', exp: Math.floor(Date.now() / 1000) + 100 },
    { role: 'user', exp: Math.floor(Date.now() / 1000) + 100 },
  ];
  for (const payload of claims) {
    assert.equal((await authorize('user', `Bearer ${jwt.sign(payload, secret)}`)).res.statusCode, 401);
  }
});

test('HS384, HS512 and unsigned tokens are rejected', async () => {
  for (const algorithm of ['HS384', 'HS512', 'none']) {
    const signed = jwt.sign({ role: 'user' }, algorithm === 'none' ? null : secret, { algorithm, subject: userId, expiresIn: '1d' });
    assert.equal((await authorize('user', `Bearer ${signed}`)).res.statusCode, 401);
  }
});

test('valid wrong-role identities return 403; deleted/unverified identities return 401', async () => {
  assert.equal((await authorize('admin', `Bearer ${token()}`)).res.statusCode, 403);
  assert.equal((await authorize('user', `Bearer ${token('admin')}`)).res.statusCode, 403);
  assert.equal((await authorize('user', `Bearer ${token()}`, { user: null })).res.statusCode, 401);
  assert.equal((await authorize('admin', `Bearer ${token('admin')}`, { admin: null })).res.statusCode, 401);
  assert.equal((await authorize('admin', `Bearer ${token()}`, { user: null })).res.statusCode, 401);
  assert.equal((await authorize('user', `Bearer ${token()}`, { user: { _id: userId, isVerified: false } })).res.statusCode, 401);
});

test('DB authentication failures are generic 500 errors', async () => {
  const { res, next } = await authorize('user', `Bearer ${token()}`, { failDB: true });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, 'Server error');
  assert.deepEqual(Object.keys(res.body), ['message']);
  assert.equal(next, false);
});

function controllers(User, Admin, env) {
  const deps = {
    '../models/User': User, '../models/Admin': Admin,
    '../utils/sendEmail': async () => {},
    '../config/urls': { clientUrl: () => 'http://localhost:5173', serverUrl: () => 'http://localhost:5001' },
  };
  return { ...load('controllers/authController.js', deps, env), ...load('controllers/adminController.js', deps, env) };
}

test('real bcrypt admin login normalizes email and signs one-day admin JWT', async () => {
  const password = await bcrypt.hash('admin-test-password', 4);
  let query;
  const { loginAdmin } = controllers({}, { findOne: async value => { query = value; return { _id: adminId, email: 'admin@example.test', password }; } });
  const res = response();
  await loginAdmin({ body: { email: ' Admin@Example.Test ', password: 'admin-test-password' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(query.email, 'admin@example.test');
  assert.equal(res.body.admin.role, 'admin');
  assert.equal(res.body.admin.password, undefined);
  const claims = jwt.verify(res.body.token, secret, { algorithms: ['HS256'] });
  assert.equal(claims.role, 'admin');
  assert.equal(claims.sub, adminId);
  assert.equal(claims.exp - claims.iat, 86400);
});

test('admin login rejects wrong-password, nonexistent identity and non-string input', async () => {
  const password = await bcrypt.hash('right-password', 4);
  for (const admin of [null, { password }]) {
    const { loginAdmin } = controllers({}, { findOne: async () => admin });
    const res = response();
    await loginAdmin({ body: { email: 'admin@example.test', password: 'wrong' } }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, 'Invalid credentials');
  }
  const { loginAdmin } = controllers({}, { findOne: async () => { throw new Error('must not query'); } });
  for (const body of [{ email: { $ne: '' }, password: 'x' }, { email: 'admin@example.test', password: ['x'] }, {}]) {
    const res = response(); await loginAdmin({ body }, res); assert.equal(res.statusCode, 400);
  }
});

test('missing JWT_SECRET does not leak implementation errors on login', async () => {
  const password = await bcrypt.hash('right-password', 4);
  const { loginAdmin, loginUser } = controllers(
    { findOne: async () => ({ _id: userId, isVerified: true, password }) },
    { findOne: async () => ({ _id: adminId, password }) }, {},
  );
  for (const login of [loginAdmin, loginUser]) {
    const res = response(); await login({ body: { email: 'a@example.test', password: 'right-password' } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, 'Server error');
    assert.deepEqual(Object.keys(res.body), ['message']);
  }
});

test('user login signs user subject/role and current profiles omit private fields', async () => {
  const user = { _id: userId, name: 'User', email: 'u@example.test', isVerified: true, password: await bcrypt.hash('user-password', 4), verificationToken: 'private' };
  const admin = { _id: adminId, email: 'a@example.test', password: 'private' };
  const { loginUser, getCurrentUser, getCurrentAdmin } = controllers({ findOne: async () => user }, {});
  const res = response(); await loginUser({ body: { email: user.email, password: 'user-password' } }, res);
  const claims = jwt.verify(res.body.token, secret, { algorithms: ['HS256'] });
  assert.equal(claims.role, 'user'); assert.equal(claims.sub, userId); assert.equal(claims.exp - claims.iat, 86400);
  assert.equal(res.body.user.role, 'user'); assert.equal(res.body.user.password, undefined);
  const current = response(); getCurrentUser({ identity: user }, current);
  assert.deepEqual(Object.keys(current.body.user).sort(), ['email', 'id', 'name', 'role']);
  const currentAdmin = response(); getCurrentAdmin({ identity: admin }, currentAdmin);
  assert.deepEqual(Object.keys(currentAdmin.body.admin).sort(), ['email', 'id', 'role']);
});

test('public registration whitelists User fields and cannot grant admin or verification', async () => {
  let created;
  const { registerUser } = controllers({ findOne: async () => null, create: async value => { created = value; return value; } }, {
    create: async () => { throw new Error('must not create admin'); },
  });
  const res = response();
  await registerUser({ body: { name: 'User', email: 'user@example.test', password: 'new-password', role: 'admin', admin: true, isVerified: true, _id: adminId } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(created.isVerified, false);
  assert.equal(created.role, undefined); assert.equal(created.admin, undefined); assert.equal(created._id, undefined);
  assert.equal(await bcrypt.compare('new-password', created.password), true);
});

test('manual provisioning hashes with real bcrypt and closes mocked connection', async () => {
  let created, connected = 0, disconnected = 0;
  await createAdmin({ email: ' Admin@Example.Test ', password: 'long-admin-password' }, {
    mongoose: { connect: async () => { connected++; }, disconnect: async () => { disconnected++; } }, bcrypt,
    Admin: { findOne: async () => null, create: async value => { created = value; } },
  });
  assert.equal(connected, 1); assert.equal(disconnected, 1);
  assert.equal(created.email, 'admin@example.test');
  assert.notEqual(created.password, 'long-admin-password');
  assert.equal(await bcrypt.compare('long-admin-password', created.password), true);
});

test('manual provisioning never overwrites duplicates and cleans up failed DB connection', async () => {
  for (const connectFails of [false, true]) {
    let disconnected = 0, creates = 0;
    await assert.rejects(createAdmin({ email: 'a@example.test', password: 'long-admin-password' }, {
      mongoose: { connect: async () => { if (connectFails) throw new Error('offline'); }, disconnect: async () => { disconnected++; } }, bcrypt,
      Admin: { findOne: async () => ({}), create: async () => { creates++; } },
    }));
    assert.equal(disconnected, 1); assert.equal(creates, 0);
  }
});

test('manual provisioning rejects short or bcrypt-truncated passwords before DB access', async () => {
  for (const password of ['short', 'a'.repeat(73)]) {
    await assert.rejects(createAdmin({ email: 'a@example.test', password }, {}));
  }
});

test('admin provisioning CLI refuses noninteractive input without DB/config access or secret logs', async () => {
  const output = [];
  let connected = false, configured = false;
  const module = { exports: {} };
  const request = name => {
    if (name === 'mongoose') return { connect: async () => { connected = true; }, disconnect: async () => {} };
    if (name === '../models/Admin') return {};
    if (name === 'dotenv') return { config() { configured = true; } };
    return require(name);
  };
  request.main = module;
  const processStub = {
    argv: ['node', 'createAdmin.js'], env: { MONGO_URI: 'private-db-secret' },
    stdin: { isTTY: false }, stdout: { isTTY: false, write: value => output.push(value) },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/createAdmin.js'), 'utf8'), {
    module, require: request, process: processStub, Buffer,
    console: { error: value => output.push(value), log: value => output.push(value) },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(processStub.exitCode, 1);
  assert.equal(connected, false); assert.equal(configured, false);
  assert.equal(output.length, 1);
  assert.doesNotMatch(output.join(''), /private-db-secret/);
  assert.match(output[0], /interactive terminal/);
});

test('current-user/admin routes require the corresponding role and admin exposes no registration', () => {
  for (const [file, role] of [['routes/authRoutes.js', 'user'], ['routes/adminRoutes.js', 'admin']]) {
    const routes = [];
    const marker = {};
    const controllers = new Proxy({}, { get: () => () => {} });
    load(file, {
      express: { Router: () => ({ get: (...args) => routes.push(['GET', ...args]), post: (...args) => routes.push(['POST', ...args]), patch: (...args) => routes.push(['PATCH', ...args]) }) },
      '../controllers/authController': controllers,
      '../controllers/adminController': controllers,
      '../controllers/inventoryController': controllers,
      '../middleware/auth': { requireRole: requested => { assert.equal(requested, role); return marker; } },
    });
    const me = routes.find(route => route[0] === 'GET' && route[1] === '/me');
    assert.ok(me); assert.equal(me[2], marker); assert.equal(typeof me[3], 'function');
    if (role === 'admin') assert.deepEqual(routes.map(route => route[1]).sort(), ['/inventory', '/inventory/:id', '/login', '/me']);
  }
});
