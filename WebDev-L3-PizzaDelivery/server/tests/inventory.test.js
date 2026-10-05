const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Inventory = require('../models/Inventory');
const { seedInventory, options } = require('../scripts/seedInventory');
const id = '333333333333333333333333';
function load(file, deps) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    module, require: name => { if (Object.hasOwn(deps, name)) return deps[name]; throw new Error(name); },
  });
  return module.exports;
}
function res() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
const record = (stock, threshold = 20) => ({ _id: id, name: 'Italian', category: 'base', stock, threshold, updatedAt: new Date('2026-01-01') });
function controllers(Model) { return load('controllers/inventoryController.js', { '../models/Inventory': Model }); }

test('inventory status boundaries and user availability include zero stock without private counts', async () => {
  const rows = [record(0), record(1), record(20), record(21)];
  const api = controllers({ find: () => ({ sort: async () => rows }) });
  const admin = res(); await api.getInventory({}, admin);
  assert.deepEqual(Array.from(admin.body.items, item => item.status), ['out-of-stock', 'low-stock', 'low-stock', 'available']);
  assert.deepEqual(Object.keys(admin.body.items[0]).sort(), ['category', 'id', 'name', 'status', 'stock', 'threshold', 'updatedAt']);
  const user = res(); await api.getIngredients({}, user);
  assert.equal(user.body.ingredients.length, 4);
  assert.deepEqual(Array.from(user.body.ingredients, item => item.available), [false, true, true, true]);
  assert.deepEqual(Object.keys(user.body.ingredients[0]).sort(), ['available', 'category', 'id', 'name']);
});

test('PATCH rejects invalid values, unknown fields and empty bodies without touching DB', async () => {
  let calls = 0;
  const api = controllers({ findByIdAndUpdate: async () => { calls++; } });
  const bad = [null, [], {}, {stock:'10'}, {stock:null}, {stock:true}, {stock:-1}, {stock:1.2}, {stock:NaN}, {stock:Infinity}, {stock:Number.MAX_SAFE_INTEGER + 1}, {threshold:-1}, {threshold:1.1}, {stock:{$inc:1}}, {$set:{stock:10}}, {name:'Replacement'}, {stock:1, role:'admin'}];
  for (const body of bad) {
    const response = res(); await api.updateInventory({params:{id}, body}, response);
    assert.equal(response.statusCode, 400);
  }
  assert.equal(calls, 0);
});

test('PATCH validates ID and distinguishes missing item; uses whitelisted atomic update', async () => {
  let args;
  const api = controllers({ findByIdAndUpdate: async (...value) => { args = value; return record(0,0); } });
  for (const invalid of ['bad', 'a'.repeat(12), {$ne:''}, null]) {
    const response = res(); await api.updateInventory({params:{id:invalid}, body:{stock:0}}, response); assert.equal(response.statusCode,400);
  }
  assert.equal(args, undefined);
  const response = res(); await api.updateInventory({params:{id}, body:{stock:0, threshold:0}}, response);
  assert.equal(response.statusCode,200); assert.equal(response.body.item.status,'out-of-stock');
  assert.equal(args[0],id); assert.deepEqual(Object.keys(args[1]), ['$set']);
  assert.equal(args[1].$set.stock,0); assert.equal(args[1].$set.threshold,0);
  assert.equal(args[2].new,true); assert.equal(args[2].runValidators,true);
  const missing = res(); await controllers({findByIdAndUpdate:async()=>null}).updateInventory({params:{id},body:{threshold:5}}, missing);
  assert.equal(missing.statusCode,404);
});

test('inventory database failures do not reveal diagnostics', async () => {
  const api = controllers({find:()=>({sort:async()=>{throw new Error('private-secret');}}), findByIdAndUpdate:async()=>{throw new Error('private-secret');}});
  for (const name of ['getInventory','getIngredients','updateInventory']) {
    const response = res(); await api[name]({params:{id},body:{stock:1}},response);
    assert.equal(response.statusCode,500); assert.equal(response.body.message,'Server error'); assert.deepEqual(Object.keys(response.body),['message']);
  }
});

test('real Inventory schema normalizes names, enforces categories and safe integer bounds', async () => {
  const valid = new Inventory({name:'  Classic   Thin  ',category:'base',stock:0,threshold:0});
  assert.equal(valid.name,'Classic Thin'); await valid.validate();
  for (const patch of [{stock:-1},{stock:1.5},{stock:Number.MAX_SAFE_INTEGER+1},{threshold:-1},{threshold:2.5},{threshold:null},{category:'meat'},{name:'   '}]) {
    await assert.rejects(new Inventory({name:'Italian',category:'base',stock:50,threshold:20,...patch}).validate());
  }
  const index = Inventory.schema.indexes().find(([keys])=>keys.category===1 && keys.name===1);
  assert.ok(index); assert.equal(index[1].unique,true);
});

function fakeSeed({failIndex=false,failConnect=false,duplicateRace=false}={}) {
  const records = new Map(); let writes=0, closes=0, indexReady=false;
  const db = {connect:async()=>{if(failConnect)throw new Error('connection-failure');},disconnect:async()=>{closes++;}};
  const Model = {
    createIndexes:async()=>{if(failIndex)throw new Error('duplicate-index');indexReady=true;},
    exists:async({category,name})=>records.has(`${category}:${name}`),
    updateOne:async(filter,update,opts)=>{
      assert.equal(indexReady,true);assert.equal(opts.upsert,true);assert.equal(opts.timestamps,false);assert.equal(opts.runValidators,true);
      assert.deepEqual(Object.keys(update),['$setOnInsert']);
      const key=`${filter.category}:${filter.name}`;
      if(!records.has(key)){records.set(key,{...update.$setOnInsert});writes++;if(duplicateRace)throw Object.assign(new Error('duplicate'),{code:11000});}
    },
  };
  return {db,Model,records,get writes(){return writes;},get closes(){return closes;}};
}

test('seed inserts exactly builder options and repeated seed preserves edits and timestamps', async () => {
  const f=fakeSeed(); await seedInventory({mongoose:f.db,Inventory:f.Model});
  assert.equal(f.records.size,20);assert.equal(f.writes,20);assert.equal(f.closes,1);
  assert.deepEqual(Object.keys(options),['base','sauce','cheese','vegetable']);
  const existing=f.records.get('base:Classic Thin');existing.stock=7;existing.threshold=9;const timestamp=existing.updatedAt;
  await seedInventory({mongoose:f.db,Inventory:f.Model});
  assert.equal(f.writes,20);assert.equal(f.closes,2);assert.equal(existing.stock,7);assert.equal(existing.threshold,9);assert.equal(existing.updatedAt,timestamp);
  for(const [key,item] of f.records) if(key!=='base:Classic Thin'){assert.equal(item.stock,50);assert.equal(item.threshold,20);}
});

test('seed refuses writes when index/connect fails and always closes; duplicate-key races preserve item', async () => {
  for(const flags of [{failIndex:true},{failConnect:true}]){
    const f=fakeSeed(flags);await assert.rejects(seedInventory({mongoose:f.db,Inventory:f.Model}));assert.equal(f.writes,0);assert.equal(f.closes,1);
  }
  const f=fakeSeed({duplicateRace:true});await seedInventory({mongoose:f.db,Inventory:f.Model});assert.equal(f.records.size,20);assert.equal(f.closes,1);
});

test('inventory routes enforce admin/user role guards including PATCH', () => {
  for(const [file,role] of [['routes/adminRoutes.js','admin'],['routes/inventoryRoutes.js','user']]){
    const routes=[]; const marker={};const fn=()=>{};
    load(file,{
      express:{Router:()=>Object.fromEntries(['get','post','patch'].map(method=>[method,(...args)=>routes.push([method,...args])]))},
      '../middleware/auth':{requireRole:value=>{assert.equal(value,role);return marker;}},
      '../controllers/adminController':{loginAdmin:fn,getCurrentAdmin:fn},
      '../controllers/inventoryController':{getInventory:fn,updateInventory:fn,getIngredients:fn},
    });
    const targets=role==='admin'?routes.filter(route=>route[1].startsWith('/inventory')):routes;
    assert.equal(targets.length,role==='admin'?2:1);
    for(const route of targets){assert.equal(route[2],marker);assert.equal(typeof route[3],'function');}
  }
});
