const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const http = require('node:http');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const secret = 'offline-orders-http-secret';
const users = ['111111111111111111111111','222222222222222222222222'];
const admin = '333333333333333333333333';
function load(file,deps){const module={exports:{}};const actualRequire=require('node:module').createRequire(path.join(__dirname,'..',file));vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{module,process:{env:{JWT_SECRET:secret}},require:name=>Object.hasOwn(deps,name)?deps[name]:actualRequire(name)});return module.exports;}

test('HTTP orders enforce JWT roles, save authoritative pending snapshot, replay, and hide other owners',async t=>{
 const ingredients=['base','sauce','cheese'].map((category,i)=>({_id:String(i+4).repeat(24),category,name:category,stock:5,priceCurrency:'EUR',priceMinor:[350,50,125][i]}));
 const selection={baseId:ingredients[0]._id,sauceId:ingredients[1]._id,cheeseId:ingredients[2]._id,vegetableIds:[],quantity:2};
 const saved=[];
 const Model={createIndexes:async()=>{},findOne:async query=>saved.find(row=>Object.entries(query).every(([key,val])=>String(row[key])===String(val)))||null,
  find:query=>({sort:async()=>saved.filter(row=>Object.entries(query).every(([key,val])=>String(row[key])===String(val)))}),
  create:async value=>{const row={...value,_id:'999999999999999999999999',createdAt:new Date()};saved.push(row);return row;},
 };
 const quote=load('services/orderQuote.js',{'../models/Inventory':{find:async()=>ingredients}});
 const controller=load('controllers/orderController.js',{'../models/Order':Model,'../services/orderQuote':quote});
 const middleware=load('middleware/auth.js',{
  '../models/User':{findById:async id=>users.includes(id)?{_id:id,isVerified:true}:null},
  '../models/Admin':{findById:async id=>id===admin?{_id:id}:null},
 });
 const routes=load('routes/orderRoutes.js',{express,'../controllers/orderController':controller,'../middleware/auth':middleware});
 const app=express();app.use(express.json());app.use('/api/orders',routes);
 const server=http.createServer(app);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const tokens={owner:jwt.sign({role:'user'},secret,{algorithm:'HS256',subject:users[0],expiresIn:'1d'}),other:jwt.sign({role:'user'},secret,{algorithm:'HS256',subject:users[1],expiresIn:'1d'}),admin:jwt.sign({role:'admin'},secret,{algorithm:'HS256',subject:admin,expiresIn:'1d'})};
 const request=(method,url,role,body)=>new Promise((resolve,reject)=>{
  const data=body===undefined?undefined:JSON.stringify(body);const headers={Connection:'close'};
  if(role)headers.Authorization=`Bearer ${tokens[role]}`;if(data){headers['Content-Type']='application/json';headers['Content-Length']=Buffer.byteLength(data);}
  const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:url,method,headers},res=>{let value='';res.setEncoding('utf8');res.on('data',chunk=>{value+=chunk;});res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(value)}));});req.on('error',reject);req.end(data);
 });
 assert.equal((await request('POST','/api/orders/quote',null,selection)).status,401);
 assert.equal((await request('POST','/api/orders/quote','admin',selection)).status,403);
 const quoted=await request('POST','/api/orders/quote','owner',selection);assert.equal(quoted.status,200);assert.equal(quoted.body.quote.totalMinor,1050);
 const body={...selection,quoteFingerprint:quoted.body.quote.fingerprint,idempotencyKey:'http-purchase-key-001'};
 const created=await request('POST','/api/orders','owner',body);assert.equal(created.status,201);assert.equal(created.body.order.status,'pending_payment');
 assert.equal(ingredients[0].stock,5);
 const id=created.body.order.id;
 assert.equal((await request('GET',`/api/orders/${id}`,'other')).status,404);
 assert.equal((await request('GET',`/api/orders/${id}`,'owner')).status,200);
 assert.equal((await request('GET',`/api/orders/${id}`,'admin')).status,403);
 assert.equal((await request('GET','/api/orders','other')).body.orders.length,0);
 ingredients[0].stock=0;ingredients[0].priceMinor++;
 const replay=await request('POST','/api/orders','owner',body);assert.equal(replay.status,200);assert.equal(replay.body.order.totalMinor,1050);assert.equal(saved.length,1);
 assert.equal((await request('POST','/api/orders','owner',{...body,quantity:3})).body.code,'IDEMPOTENCY_CONFLICT');
 assert.equal(saved[0].paymentStatus,undefined);assert.equal(saved[0].orderStatus,undefined);
});
