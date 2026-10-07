const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const jwt = require('jsonwebtoken');
const http = require('node:http');
const secret = 'offline-inventory-http-test-secret';
const userId = '111111111111111111111111';
const adminId = '222222222222222222222222';
const itemId = '333333333333333333333333';
function load(file, deps) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    module, process: { env: { JWT_SECRET: secret } },
    require: name => { if (Object.hasOwn(deps, name)) return deps[name]; throw new Error(name); },
  });
  return module.exports;
}

test('HTTP inventory endpoints compose real Express routes, JWT middleware and role checks', async (t) => {
  const item = { _id: itemId, name: 'Italian', category: 'base', stock: 50, threshold: 20, updatedAt: new Date() };
  let writes = 0;
  const Model = {
    find: () => ({ sort: async () => [item] }),
    findByIdAndUpdate: async (id, update) => {
      assert.equal(id, itemId); writes++;
      Object.assign(item, update.$set); return item;
    },
  };
  const middleware = load('middleware/auth.js', {
    jsonwebtoken: jwt,
    '../models/User': { findById: async id => id === userId ? { _id: userId, isVerified: true } : null },
    '../models/Admin': { findById: async id => id === adminId ? { _id: adminId } : null },
  });
  const inventory = load('controllers/inventoryController.js', { '../models/Inventory': Model, '../services/pricing': require('../services/pricing') });
  const adminRoutes = load('routes/adminRoutes.js', {
    express, '../middleware/auth': middleware, '../controllers/inventoryController': inventory,
    '../controllers/adminController': { loginAdmin() {}, getCurrentAdmin() {} },
    '../controllers/adminOrderController': { getAdminOrders() {}, getAdminOrder() {}, updateFulfillment() {} },
  });
  const ingredientRoutes = load('routes/inventoryRoutes.js', {
    express, '../middleware/auth': middleware, '../controllers/inventoryController': inventory,
  });
  const app = express(); app.use(express.json());
  app.use('/api/admin', adminRoutes); app.use('/api/ingredients', ingredientRoutes);
  const server = http.createServer(app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const tokens = Object.fromEntries(['user','admin'].map(role => [role, jwt.sign({role}, secret, {
    algorithm:'HS256', subject:role==='user'?userId:adminId, expiresIn:'1d',
  })]));
  async function request(method, url, role, body) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const headers = { Connection: 'close' };
      if (role) headers.Authorization = `Bearer ${tokens[role]}`;
      if (data) { headers['Content-Type']='application/json'; headers['Content-Length']=Buffer.byteLength(data); }
      const req = http.request({ hostname:'127.0.0.1', port, path:url, method, headers }, res => {
        let text=''; res.setEncoding('utf8'); res.on('data',chunk=>{text+=chunk;});
        res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));
      });
      req.on('error',reject);req.end(data);
    });
  }
  for (const method of ['GET','PATCH']) {
    const url = method==='GET'?'/api/admin/inventory':`/api/admin/inventory/${itemId}`;
    const body = method==='PATCH'?{stock:0,threshold:5}:undefined;
    assert.equal((await request(method,url,undefined,body)).status,401);
    assert.equal((await request(method,url,'user',body)).status,403);
    assert.equal(writes,0);
    const allowed = await request(method,url,'admin',body);
    assert.equal(allowed.status,200);
    if(method==='GET') assert.equal(allowed.body.items[0].stock,50);
    else assert.equal(allowed.body.item.status,'out-of-stock');
  }
  assert.equal(writes,1);
  assert.equal((await request('GET','/api/ingredients')).status,401);
  assert.equal((await request('GET','/api/ingredients','admin')).status,403);
  const available = await request('GET','/api/ingredients','user');
  assert.equal(available.status,200); assert.equal(available.body.ingredients[0].available,false);
  assert.equal(available.body.ingredients[0].stock,undefined);
  assert.equal(available.body.ingredients[0].threshold,undefined);
});
