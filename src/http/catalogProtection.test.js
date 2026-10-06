const test=require('node:test');const assert=require('node:assert/strict');const express=require('express');
const {createCatalogProtection}=require('./catalogProtection');
async function fixture(t,options,handler){const app=express();app.use(createCatalogProtection(options));app.get('/movies/:id',handler);app.get('/movies/:id/reelbot-take',(req,res)=>res.json({take:true}));const server=app.listen(0);t.after(()=>server.close());return path=>fetch(`http://127.0.0.1:${server.address().port}${path}`);}
test('cached reads survive throttling; separate metadata budget and refill',async t=>{
let time=0,calls=0;const request=await fixture(t,{now:()=>time,burst:1,detailPerHour:3600,metadataPerHour:3600},(req,res)=>{calls++;res.json({id:req.params.id});});
assert.equal((await request('/movies/1')).status,200);const denied=await request('/movies/2');assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'1');assert.match(denied.headers.get('cache-control'),/no-store/);
assert.equal((await request('/movies/1?unused=1')).headers.get('x-reelbot-catalog-cache'),'HIT');assert.equal((await request('/movies/1?view=metadata')).status,200);assert.equal((await request('/movies/1/reelbot-take')).status,200);
time=1000;assert.equal((await request('/movies/2')).status,200);assert.equal(calls,3);
});
test('coalesces concurrent reads; caches 404 but retries upstream failures',async t=>{
let calls=0;const request=await fixture(t,{},async(req,res)=>{calls++;await new Promise(resolve=>setTimeout(resolve,20));res.status(req.params.id==='404'?404:req.params.id==='500'?503:200).json({id:req.params.id});});
const pair=await Promise.all([request('/movies/1'),request('/movies/1')]);assert.ok(pair.every(r=>r.status===200));assert.equal(calls,1);await request('/movies/404');await request('/movies/404');assert.equal(calls,2);await request('/movies/500');await request('/movies/500');assert.equal(calls,4);
});
test('cache is bounded and expires',async t=>{let time=0,calls=0;const request=await fixture(t,{now:()=>time,maxEntries:1,ttl:100},(req,res)=>{calls++;res.json({id:req.params.id});});await request('/movies/1');await request('/movies/2');await request('/movies/1');assert.equal(calls,3);time=101;await request('/movies/1');assert.equal(calls,4);});

test('detail concurrency leaves metadata headroom, including person page metadata',async t=>{
 const app=express();app.use(createCatalogProtection({maxPending:3,metadataReserved:1}));
 let unblock;const block=new Promise(resolve=>{unblock=resolve;});
 app.get('/movies/:id',async(req,res)=>{if(!req.query.view)await block;res.json({id:req.params.id});});
 app.get('/people/resolve/:slug',(req,res)=>res.json({name:req.params.slug}));
 const server=app.listen(0);t.after(()=>{unblock();server.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 const one=fetch(base+'/movies/1');const two=fetch(base+'/movies/2');
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal((await fetch(base+'/movies/3')).status,429);
 assert.equal((await fetch(base+'/movies/4?view=metadata')).status,200);
 assert.equal((await fetch(base+'/people/resolve/christopher-nolan?view=metadata')).status,200);
 unblock();assert.equal((await one).status,200);assert.equal((await two).status,200);
});
