const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const Order = require('../models/Order');
const Inventory = require('../models/Inventory');
const {seedPrices,demoPrices} = require('../scripts/seedPrices');
const ids = ['aaaaaaaaaaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbbbbbbbbbb','cccccccccccccccccccccccc','dddddddddddddddddddddddd','eeeeeeeeeeeeeeeeeeeeeeee'];
const user = '111111111111111111111111';
const selection = {baseId:ids[0],sauceId:ids[1],cheeseId:ids[2],vegetableIds:[ids[4],ids[3]],quantity:2};
function load(file,deps){const module={exports:{}};const actualRequire=require('node:module').createRequire(path.join(__dirname,'..',file));vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{module,require:name=>Object.hasOwn(deps,name)?deps[name]:actualRequire(name)});return module.exports;}
function response(){return {statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
function harness({indexFails=false}={}){
 const rows=ids.map((id,i)=>({_id:id,name:`Ingredient ${i}`,category:['base','sauce','cheese','vegetable','vegetable'][i],stock:50,priceCurrency:'EUR',priceMinor:[350,50,125,50,75][i]}));
 const state={rows,orders:[],creates:0,indexCalls:0,findCalls:0};
 const quote=load('services/orderQuote.js',{'../models/Inventory':{find:async()=>{state.findCalls++;return rows;}}});
 const {matches,queryChain}=require('./orderMockHelpers');
 const Model={
  createIndexes:async()=>{state.indexCalls++;if(indexFails)throw new Error('index unavailable');},
  findOne:async filter=>state.orders.find(row=>matches(row,filter))||null,
  find:filter=>queryChain(state.orders,filter),
  countDocuments:async filter=>state.orders.filter(row=>matches(row,filter)).length,
  create:async value=>{await new Promise(resolve=>setImmediate(resolve));if(state.orders.some(row=>row.user===value.user&&row.idempotencyKey===value.idempotencyKey))throw Object.assign(new Error('duplicate'),{code:11000});state.creates++;const row={...value,_id:'99999999999999999999999'+state.creates,createdAt:new Date()};state.orders.push(row);return row;},
 };
 const api=load('controllers/orderController.js',{'../models/Order':Model,'../services/orderQuote':quote});
 const invoke=async(name,body,identity=user,params={})=>{const res=response();await api[name]({body,identity:{_id:identity},params},res);return res;};
 const validBody=async(key='purchase-key-00001')=>({...selection,quoteFingerprint:(await quote.buildQuote(quote.normalizeSelection(selection))).fingerprint,idempotencyKey:key});
 return {state,quote,api,invoke,validBody};
}

test('quotes use authoritative EUR safe-integer math and canonical stable fingerprints',async()=>{
 const {quote}=harness();const canonical=quote.normalizeSelection(selection);const snapshot=await quote.buildQuote(canonical);
 assert.equal(snapshot.currency,'EUR');assert.equal(snapshot.unitTotalMinor,650);assert.equal(snapshot.totalMinor,1300);assert.equal(snapshot.items[0].lineTotalMinor,700);assert.match(snapshot.fingerprint,/^[a-f\d]{64}$/);
 const permuted={...selection,baseId:ids[0].toUpperCase(),vegetableIds:[ids[3].toUpperCase(),ids[4]]};
 assert.equal((await quote.buildQuote(quote.normalizeSelection(permuted))).fingerprint,snapshot.fingerprint);
 assert.equal(quote.selectionHash(canonical),quote.selectionHash(quote.normalizeSelection(permuted)));
});

test('selection rejects malformed IDs, duplicate vegetables, quantity bounds and frontend price injection',async()=>{
 const {invoke}=harness();const invalid=[null,[],{}, {...selection,baseId:{$ne:''}}, {...selection,baseId:'short'}, {...selection,quantity:'2'}, {...selection,quantity:0}, {...selection,quantity:11}, {...selection,quantity:1.5}, {...selection,quantity:null}, {...selection,vegetableIds:[ids[3],ids[3].toUpperCase()]}, {...selection,vegetableIds:'x'}, {...selection,totalMinor:1}, {...selection,role:'admin'}];
 for(const body of invalid){const res=await invoke('quoteOrder',body);assert.equal(res.statusCode,400);assert.equal(res.body.code,'INVALID_SELECTION');}
});

test('wrong categories/missing ingredients fail; missing price and insufficient stock report affected IDs',async()=>{
 for(const [change,code,status] of [
  [rows=>rows.pop(),'INVALID_SELECTION',400],
  [rows=>{rows[0].category='vegetable';},'INVALID_SELECTION',400],
  [rows=>{rows[0].stock=1;},'INGREDIENT_UNAVAILABLE',409],
  [rows=>{delete rows[0].priceMinor;},'PRICE_UNAVAILABLE',409],
  [rows=>{rows[0].priceMinor=null;},'PRICE_UNAVAILABLE',409],
  [rows=>{delete rows[0].priceCurrency;},'PRICE_UNAVAILABLE',409],
  [rows=>{rows[0].priceCurrency='INR';},'PRICE_UNAVAILABLE',409],
 ]){const {state,invoke}=harness();change(state.rows);const res=await invoke('quoteOrder',selection);assert.equal(res.statusCode,status);assert.equal(res.body.code,code);if(status===409)assert.equal(res.body.ingredientIds[0],ids[0]);}
 const {state,invoke}=harness();state.rows[0].priceMinor=0;state.rows[0].stock=2;assert.equal((await invoke('quoteOrder',selection)).statusCode,200);
});

test('quote price addition and multiplication overflow fail instead of rounding',async()=>{
 for(const prices of [[Number.MAX_SAFE_INTEGER,1,0,0,0],[Math.floor(Number.MAX_SAFE_INTEGER/2),1,0,0,0]]){
  const {state,invoke}=harness();state.rows.forEach((row,i)=>{row.priceMinor=prices[i];});const res=await invoke('quoteOrder',selection);assert.equal(res.statusCode,409);assert.equal(res.body.code,'PRICE_UNAVAILABLE');
 }
});

test('pending order snapshots save without kitchen/payment defaults; same key replays after stock/price changes',async()=>{
 const {state,invoke,validBody}=harness();const body=await validBody();const first=await invoke('createOrder',body);
 assert.equal(first.statusCode,201);assert.equal(first.body.order.status,'pending_payment');assert.equal(state.orders[0].paymentStatus,'pending');assert.equal(state.orders[0].orderStatus,undefined);assert.equal(state.indexCalls,1);
 state.rows.forEach(row=>{row.priceMinor=1;row.stock=0;});
 const replay=await invoke('createOrder',{...body,vegetableIds:[ids[3].toUpperCase(),ids[4]],baseId:ids[0].toUpperCase(),quoteFingerprint:'f'.repeat(64)});
 assert.equal(replay.statusCode,200);assert.equal(replay.body.order.totalMinor,first.body.order.totalMinor);assert.equal(replay.body.order.id,first.body.order.id);assert.equal(state.creates,1);
 const conflict=await invoke('createOrder',{...body,quantity:3});assert.equal(conflict.statusCode,409);assert.equal(conflict.body.code,'IDEMPOTENCY_CONFLICT');
 assert.deepEqual(Object.keys(first.body.order).sort(),['checkoutEligible','confirmedAt','createdAt','currency','fulfillmentHistory','fulfillmentStatus','id','items','nextFulfillmentStatus','paymentIssue','paymentStatus','quantity','status','totalMinor','unitTotalMinor','updatedAt']);
});

test('changed quote returns fresh snapshot without creating; bad idempotency/fingerprint rejected',async()=>{
 const {state,invoke,validBody}=harness();const body=await validBody();state.rows[0].priceMinor++;
 const changed=await invoke('createOrder',body);assert.equal(changed.statusCode,409);assert.equal(changed.body.code,'PRICE_CHANGED');assert.equal(changed.body.quote.totalMinor,1302);assert.equal(state.creates,0);
 for(const patch of [{idempotencyKey:'short'},{idempotencyKey:'a'.repeat(129)},{idempotencyKey:'a'.repeat(16)+'/'},{quoteFingerprint:'z'.repeat(64)},{quoteFingerprint:null},{paid:true}])assert.equal((await invoke('createOrder',{...body,...patch})).statusCode,400);
});

test('concurrent same-key creation saves once, returns stable replay and unique index failure blocks insert',async()=>{
 const {state,invoke,validBody}=harness();const body=await validBody();const results=await Promise.all([invoke('createOrder',body),invoke('createOrder',body)]);
 assert.deepEqual(results.map(res=>res.statusCode).sort(),[200,201]);assert.equal(state.creates,1);assert.equal(state.indexCalls,1);assert.equal(results[0].body.order.id,results[1].body.order.id);
 const fail=harness({indexFails:true});assert.equal((await fail.invoke('createOrder',await fail.validBody())).statusCode,500);assert.equal(fail.state.creates,0);
});

test('user-owned order reads exclude other users and legacy documents',async()=>{
 const {state,invoke,validBody}=harness();const created=await invoke('createOrder',await validBody());const id=created.body.order.id;
 assert.equal((await invoke('getOrder',null,user,{id})).statusCode,200);
 assert.equal((await invoke('getOrder',null,'222222222222222222222222',{id})).statusCode,404);
 assert.equal((await invoke('getOrder',null,user,{id:'bad'})).statusCode,400);
 state.orders.push({_id:'888888888888888888888888',user,paymentStatus:'Paid',orderStatus:'Order Received'});
 assert.equal((await invoke('getOrders',null)).body.orders.length,1);
 assert.equal((await invoke('getOrders',null,'222222222222222222222222')).body.orders.length,0);
});

test('real schemas permit absent ingredient price, reject invalid price, and preserve legacy order compatibility',async()=>{
 await new Inventory({name:'Italian',category:'base',stock:1,threshold:0}).validate();
 for(const priceMinor of [null,-1,1.1,Number.MAX_SAFE_INTEGER+1])await assert.rejects(new Inventory({name:'Italian',category:'base',priceMinor}).validate());
 await new Inventory({name:'Italian',category:'base',priceMinor:0}).validate();
 await new Order({user,base:'Old',sauce:'Old',cheese:'Old',totalPrice:10,paymentStatus:'Paid'}).validate();
 const empty=new Order({user,status:'pending_payment'});await assert.rejects(empty.validate());assert.equal(empty.paymentStatus,undefined);assert.equal(empty.orderStatus,undefined);
 const index=Order.schema.indexes().find(([keys])=>keys.user===1&&keys.idempotencyKey===1);assert.ok(index);assert.equal(index[1].unique,true);assert.equal(index[1].partialFilterExpression.idempotencyKey.$type,'string');
});

test('EUR migration replaces legacy demo prices once, preserves existing EUR prices and all non-price fields',async()=>{
 const rows=[{name:'Classic Thin',category:'base',priceMinor:9900,stock:7,threshold:9,_id:ids[0],updatedAt:'original'},
  {name:'Italian',category:'base',priceCurrency:'EUR',priceMinor:0,stock:2},
  {name:'Mozzarella',category:'cheese',priceCurrency:'EUR',priceMinor:null},
  {name:'Unknown',category:'vegetable',stock:50},
  {name:'BBQ',category:'sauce',priceCurrency:'INR',priceMinor:2000},
  {name:'Parmesan',category:'cheese',priceCurrency:'EUR'},
  {name:'Pesto',category:'sauce',priceCurrency:'EUR',priceMinor:123}];
 let closed=0;const Model={updateOne:async(filter,update,opts)=>{
  assert.equal(filter.$or.length,3);assert.equal(opts.timestamps,false);assert.equal(opts.runValidators,true);assert.equal(opts.upsert,undefined);assert.deepEqual(Object.keys(update),['$set']);assert.deepEqual(Object.keys(update.$set),['priceMinor','priceCurrency']);assert.equal(update.$set.priceCurrency,'EUR');
  const row=rows.find(row=>row.category===filter.category&&row.name===filter.name&&
   (!Object.hasOwn(row,'priceCurrency')||row.priceCurrency==='INR'||(row.priceCurrency==='EUR'&&!Object.hasOwn(row,'priceMinor'))));
  if(!row)return {modifiedCount:0};Object.assign(row,update.$set);return {modifiedCount:1};
 },find:async()=>rows};const deps={mongoose:{connect:async()=>{},disconnect:async()=>{closed++;}},Inventory:Model};
 assert.deepEqual(await seedPrices(deps),{updated:3,unpriced:2});assert.deepEqual(await seedPrices(deps),{updated:0,unpriced:2});assert.equal(closed,2);assert.equal(rows[0].priceMinor,350);assert.equal(rows[0].priceCurrency,'EUR');assert.equal(rows[0].stock,7);assert.equal(rows[0].threshold,9);assert.equal(rows[0]._id,ids[0]);assert.equal(rows[0].updatedAt,'original');assert.equal(rows[1].priceMinor,0);assert.equal(rows[2].priceMinor,null);assert.equal(rows[3].priceMinor,undefined);
 assert.equal(rows[4].priceMinor,75);assert.equal(rows[5].priceMinor,175);assert.equal(rows[6].priceMinor,123);
 assert.equal(Object.values(demoPrices).reduce((n,map)=>n+Object.keys(map).length,0),20);
});

test('pending INR snapshots remain readable but are ineligible for EUR checkout; rebuild uses a new EUR snapshot',async()=>{
 const {state,invoke,validBody,quote}=harness();
 const body=await validBody('legacy-order-key-001');
 const legacyQuote={...(await quote.buildQuote(quote.normalizeSelection(selection))),currency:'INR',unitTotalMinor:17900,totalMinor:35800};
 legacyQuote.items=legacyQuote.items.map((item,i)=>({...item,unitPriceMinor:[9900,1500,3000,1500,2000][i],lineTotalMinor:[19800,3000,6000,3000,4000][i]}));
 const {fingerprint,...snapshot}=legacyQuote;
 const legacy={...snapshot,user,_id:'777777777777777777777777',createdAt:new Date('2026-10-05'),status:'pending_payment',idempotencyKey:body.idempotencyKey,selectionHash:quote.selectionHash(quote.normalizeSelection(selection))};
 state.orders.push(legacy);const original=JSON.stringify(legacy);
 const read=await invoke('getOrder',null,user,{id:legacy._id});assert.equal(read.statusCode,200);assert.equal(read.body.order.checkoutEligible,false);assert.equal(read.body.order.currency,'INR');assert.equal(read.body.order.totalMinor,35800);
 const replay=await invoke('createOrder',body);assert.equal(replay.statusCode,200);assert.equal(replay.body.order.checkoutEligible,false);assert.equal(state.creates,0);
 const oldRequest=await invoke('createOrder',{...body,idempotencyKey:'new-order-key-00001',quoteFingerprint:'f'.repeat(64)});assert.equal(oldRequest.statusCode,409);assert.equal(oldRequest.body.code,'PRICE_CHANGED');assert.equal(oldRequest.body.quote.currency,'EUR');
 const rebuilt=await invoke('createOrder',await validBody('rebuilt-order-key-001'));assert.equal(rebuilt.statusCode,201);assert.equal(rebuilt.body.order.currency,'EUR');assert.equal(rebuilt.body.order.checkoutEligible,true);assert.equal(rebuilt.body.order.totalMinor,1300);
 assert.equal(JSON.stringify(legacy),original);await new Order(legacy).validate();
});
