const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { matches, queryChain } = require('./orderMockHelpers');
const { pendingOrder, confirmedOrder } = require('./fixtures/trackingOrders');
const tracking = require('../services/orderTracking');
const Order = require('../models/Order');
function load(file,deps){const module={exports:{}};const actual=require('node:module').createRequire(path.join(__dirname,'..',file));vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{module,require:name=>Object.hasOwn(deps,name)?deps[name]:actual(name)});return module.exports;}
function response(){return {statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
function harness(rows=[confirmedOrder()]){
 const state={rows,writes:0,filters:[]};
 const Model={findOne:async query=>rows.find(row=>matches(row,query))||null,find:query=>{state.filters.push(query);return queryChain(rows,query);},countDocuments:async query=>rows.filter(row=>matches(row,query)).length,
 findOneAndUpdate:async(query,update,opts)=>{await new Promise(resolve=>setImmediate(resolve));assert.equal(opts.runValidators,true);assert.equal(opts.new,true);const row=rows.find(row=>matches(row,query));if(!row)return null;state.writes++;Object.assign(row,update.$set);row.fulfillmentHistory.push(update.$push.fulfillmentHistory);row.updatedAt=new Date();return row;}};
 const admin=load('controllers/adminOrderController.js',{'../models/Order':Model});
 const user=load('controllers/orderController.js',{'../models/Order':Model,'../services/orderQuote':{}});
 const invoke=async(name,body,options={})=>{const res=response();await (admin[name]||user[name])({body,params:{id:options.id||rows[0]?._id},query:options.query,identity:{_id:options.user||'111111111111111111111111'}},res);return res;};
 return {state,invoke,admin,user};
}

test('old pending records project defaults without writes; INR snapshot and checkout policy preserved',()=>{
 const row=pendingOrder({currency:'INR',totalMinor:35800});const result=tracking.profile(row);
 assert.equal(result.paymentStatus,'pending');assert.equal(result.fulfillmentStatus,null);assert.deepEqual(result.fulfillmentHistory,[]);assert.equal(result.confirmedAt,null);assert.equal(result.nextFulfillmentStatus,null);assert.equal(result.checkoutEligible,false);assert.equal(result.totalMinor,35800);
 assert.equal(row.paymentStatus,undefined);assert.equal(row.fulfillmentHistory,undefined);
 const confirmed=tracking.profile(confirmedOrder());assert.equal(confirmed.checkoutEligible,false);assert.equal(confirmed.nextFulfillmentStatus,'in_kitchen');
});

test('strict list pagination and filters reject operator injection and invalid values',()=>{
 for(const query of [{page:'0'},{page:'1.2'},{page:'01'},{page:['1']},{limit:'101'},{limit:'0'},{paymentStatus:'Paid'},{paymentStatus:{$ne:''}},{fulfillmentStatus:'Order Received'},{status:'confirmed'},{page:String(Number.MAX_SAFE_INTEGER),limit:'100'}])assert.throws(()=>tracking.parseList(query));
 assert.equal(tracking.parseList().limit,20);assert.equal(tracking.parseList({limit:'100'}).limit,100);
});

test('admin/user lists paginate and filter correctly; owned detail excludes other users/unsupported legacy',async()=>{
 const rows=[pendingOrder(),confirmedOrder({_id:'777777777777777777777777'}),confirmedOrder({_id:'888888888888888888888888',user:'222222222222222222222222',fulfillmentStatus:'in_kitchen'}),{_id:'999999999999999999999999',user:'111111111111111111111111',paymentStatus:'Paid',orderStatus:'Order Received'}];
 const {invoke}=harness(rows);
 const all=await invoke('getAdminOrders',null,{query:{page:'2',limit:'1'}});assert.equal(all.body.orders.length,1);assert.deepEqual(Object.values(all.body.pagination),[2,1,3,3]);
 assert.equal((await invoke('getAdminOrders',null,{query:{paymentStatus:'paid'}})).body.orders.length,2);
 assert.equal((await invoke('getAdminOrders',null,{query:{paymentStatus:'pending',fulfillmentStatus:'not_started'}})).body.orders.length,1);
 assert.equal((await invoke('getAdminOrders',null,{query:{fulfillmentStatus:'in_kitchen'}})).body.orders.length,1);
 assert.equal((await invoke('getOrders',null)).body.orders.length,2);
 assert.equal((await invoke('getOrder',null,{id:rows[2]._id})).statusCode,404);
 assert.equal((await invoke('getOrder',null,{id:rows[1]._id})).body.order.paymentStatus,'paid');
 assert.equal((await invoke('getAdminOrder',null,{id:rows[3]._id})).statusCode,404);
 assert.equal((await invoke('getAdminOrders',null,{query:{limit:'oops'}})).statusCode,400);
});

test('fulfillment requires paid+confirmed and rejects invalid, skipped, backward, stale stages',async()=>{
 for(const row of [pendingOrder(),confirmedOrder({paymentStatus:'pending'}),pendingOrder({paymentStatus:'paid'}),confirmedOrder({paymentStatus:'Paid'})]){
  const h=harness([row]);assert.equal((await h.invoke('updateFulfillment',{status:'in_kitchen',expectedStatus:'order_received'})).statusCode,409);assert.equal(h.state.writes,0);
 }
 const h=harness();for(const body of [null,{}, {status:'in_kitchen'}, {status:'in_kitchen',expectedStatus:'order_received',paymentStatus:'paid'}, {status:'In Kitchen',expectedStatus:'order_received'}])assert.equal((await h.invoke('updateFulfillment',body)).statusCode,400);
 for(const body of [{status:'sent_to_delivery',expectedStatus:'order_received'},{status:'order_received',expectedStatus:'in_kitchen'},{status:'sent_to_delivery',expectedStatus:'in_kitchen'}])assert.equal((await h.invoke('updateFulfillment',body)).statusCode,409);
 assert.equal(h.state.writes,0);
});

test('atomic forward transitions preserve monetary/payment snapshots and append history once under repeat/concurrency',async()=>{
 const h=harness();const initial=JSON.stringify(h.state.rows[0].items);const at=h.state.rows[0].confirmedAt;
 const body={status:'in_kitchen',expectedStatus:'order_received'};
 const results=await Promise.all([h.invoke('updateFulfillment',body),h.invoke('updateFulfillment',body)]);
 assert.deepEqual(results.map(res=>res.statusCode),[200,200]);assert.equal(h.state.writes,1);assert.equal(h.state.rows[0].fulfillmentHistory.length,2);
 const time=h.state.rows[0].fulfillmentHistory[1].at;
 assert.equal((await h.invoke('updateFulfillment',body)).statusCode,200);assert.equal(h.state.rows[0].fulfillmentHistory[1].at,time);assert.equal(h.state.writes,1);
 const terminal=await h.invoke('updateFulfillment',{status:'sent_to_delivery',expectedStatus:'in_kitchen'});assert.equal(terminal.statusCode,200);assert.equal(terminal.body.order.nextFulfillmentStatus,null);assert.equal(h.state.rows[0].fulfillmentHistory.length,3);assert.equal(JSON.stringify(h.state.rows[0].items),initial);assert.equal(h.state.rows[0].paymentStatus,'paid');assert.equal(h.state.rows[0].totalMinor,300);assert.equal(h.state.rows[0].confirmedAt,at);
 assert.equal((await h.invoke('updateFulfillment',body)).statusCode,409);
 assert.match(terminal.body.order.fulfillmentHistory[2].at,/Z$/);
});

test('confirmed fixture schema requires paid status, confirmation and timestamp history without converting legacy Paid',async()=>{
 await new Order(confirmedOrder()).validate();
 for(const patch of [{paymentStatus:'Paid'},{paymentStatus:'pending'},{confirmedAt:null},{fulfillmentStatus:null},{fulfillmentHistory:[]},{fulfillmentHistory:[{status:'in_kitchen'}]}])await assert.rejects(new Order(confirmedOrder(patch)).validate());
 await new Order({user:'111111111111111111111111',paymentStatus:'Paid',orderStatus:'Order Received'}).validate();
});
