const test=require('node:test');const assert=require('node:assert/strict');const express=require('express');
const {normalizeSnapshot,createSharedPickStore,installSharedPickRoutes}=require('../src/shares/sharedPicks');
const snapshot={v:1,id:671,why:'A warm adventure',brief:'Something magical'};
test('snapshots expose only the chosen movie and explicitly shared copy',()=>{
 assert.deepEqual(normalizeSnapshot({...snapshot,user_id:'private',history:[2]}),snapshot);
 assert.equal(normalizeSnapshot({...snapshot,why:'x'.repeat(1201)}),null);assert.equal(normalizeSnapshot({...snapshot,id:0}),null);
});
test('private durable storage writes immutable snapshots and can read after a new process/store',async()=>{
 const objects=new Map();const posts=[];
 const httpClient={post:async(url,data,config)=>{posts.push({url,data,config});if(url.endsWith('/bucket')){assert.equal(data.public,false);return {data:{}};}assert.equal(config.headers['x-upsert'],'false');objects.set(url,JSON.parse(data));return {data:{}};},get:async url=>({data:objects.get(url)})};
 const config={baseUrl:'https://storage.test',serviceKey:'private-key',httpClient};
 const first=createSharedPickStore(config);const token=await first.create(snapshot);assert.match(token,/^[A-Za-z0-9_-]{12}$/);
 const fresh=createSharedPickStore(config);assert.deepEqual(await fresh.get(token),snapshot);
 snapshot.why='Changed later';assert.equal((await fresh.get(token)).why,'A warm adventure');snapshot.why='A warm adventure';
 assert.equal(await fresh.get('../bad'),null);assert.equal(posts.length,2);
});
test('HTTP flow creates short links, rejects missing films, and handles storage failure',async()=>{
 const app=express();app.use(express.json());const saved=new Map();let fail=false;
 installSharedPickRoutes(app,{store:{create:async data=>{if(fail)throw Error('offline');saved.set('Abcdef123456',{...data});return 'Abcdef123456';},get:async token=>saved.get(token)},movieExists:async id=>id===671});
 const server=app.listen(0);const base=`http://127.0.0.1:${server.address().port}`;
 try {
  const post=body=>fetch(base+'/reelbot/shares',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const created=await post(snapshot);assert.equal(created.status,201);assert.deepEqual(await created.json(),{token:'Abcdef123456',path:'/p/Abcdef123456'});
  const read=await fetch(base+'/reelbot/shares/Abcdef123456');assert.deepEqual(await read.json(),snapshot);
  assert.equal((await post({...snapshot,id:123})).status,404);assert.equal((await post({...snapshot,why:''})).status,400);
  assert.equal((await fetch(base+'/reelbot/shares/not-found')).status,404);
  fail=true;assert.equal((await post(snapshot)).status,503);
 }finally {await new Promise(resolve=>server.close(resolve));}
});
