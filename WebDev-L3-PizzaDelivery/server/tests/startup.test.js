const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function start(env) {
  const state = { middleware: [], routes: [], connections: [], loadedEnv: false };
  const auth = {};
  const pizzas = {};
  const admin = {};
  const app = {
    use(...args) { state.middleware.push(args); },
    get(...args) { state.routes.push(args); },
    listen(port, callback) { state.port = port; callback(); },
  };
  const express = () => app;
  express.json = () => 'json';
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), {
    process: { env }, console: { log() {} },
    require(name) {
      if (name === 'express') return express;
      if (name === 'mongoose') return {
        connect(uri) { state.connections.push(uri); return Promise.resolve(); },
      };
      if (name === 'cors') return () => 'cors';
      if (name === 'dotenv') return { config() { state.loadedEnv = true; } };
      if (name === './routes/authRoutes') return auth;
      if (name === './routes/adminRoutes') return admin;
      if (name === './routes/pizzaRoutes') return pizzas;
      throw new Error(`Unexpected startup dependency: ${name}`);
    },
  });
  return { state, auth, admin, pizzas };
}

test('server entry starts on default PORT and mounts auth/catalog without external IO', () => {
  const { state, auth, admin, pizzas } = start({ MONGO_URI: 'mock://offline' });
  assert.equal(state.port, 5001);
  assert.equal(state.loadedEnv, true);
  assert.deepEqual(state.connections, ['mock://offline']);
  assert.deepEqual(state.middleware, [['cors'], ['json'], ['/api/auth', auth], ['/api/admin', admin], ['/api/pizzas', pizzas]]);
  assert.deepEqual(state.routes.map(([route]) => route), ['/', '/test']);
  let message;
  state.routes[0][1]({}, { send(value) { message = value; } });
  assert.equal(message, 'Pizza Delivery API is running');
});

test('server entry respects configured PORT', () => {
  assert.equal(start({ PORT: '6000', MONGO_URI: 'mock://offline' }).state.port, 6000);
});

test('npm entry and scripts target existing server and offline test files', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.equal(pkg.main, 'server.js');
  assert.equal(pkg.scripts.start, 'node server.js');
  assert.equal(pkg.scripts.dev, 'node --watch server.js');
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.js');
  assert.ok(fs.existsSync(path.join(__dirname, '..', pkg.main)));
});
