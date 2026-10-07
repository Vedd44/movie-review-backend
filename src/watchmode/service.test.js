const test = require('node:test');
const assert = require('node:assert/strict');
const {createWatchmodeService,normalizeSources,CACHE_TTL} = require('./service');
const {installWatchmodeRoutes} = require('./routes');
const source = (overrides={}) => ({source_id:203,name:'Netflix',type:'sub',region:'US',web_url:'https://www.netflix.com/title/123',...overrides});
function fixture(options={}) {
  let time=Date.parse('2026-10-07T19:00:00Z');
  const records = new Map(), calls=[];
  const store={enabled:true,get:async key=>records.get(key)||null,set:async(key,value)=>{records.set(key,value);}};
  const httpClient={get:async(url,config)=>{calls.push({url,config});return {data:url.includes('/status/')?{quota:2500,quotaUsed:0}:[source()]};}};
  const args={apiKey:'test-key',httpClient,store,now:()=>time,log:()=>{},...options};
  return {args,records,calls,store,service:createWatchmodeService(args),advance:delta=>{time+=delta;}};
}
test('normalizes US offers without conflating rental, free, cable, or channel brands',()=>{
 const result=normalizeSources([source(),source({type:'rent',price:5}),source({type:'rent',price:3}),source({source_id:9,type:'free',name:'Tubi'}),source({source_id:10,type:'tve'}),source({source_id:11,name:'Paramount+ Amazon Channel'}),source({region:'GB'}),source({web_url:'javascript:alert(1)'}),source({web_url:'https://a:b@example.com'})],Date.now());
 assert.equal(result.subscription.length,2);assert.equal(result.rent.length,1);assert.equal(result.rent[0].price,3);assert.equal(result.free.length,1);assert.equal(result.cable.length,1);assert.equal(result.subscription[1].name,'Paramount+ Amazon Channel');
 assert.equal(normalizeSources([source({region:'GB'})],Date.now()),null);
 assert.equal(normalizeSources([],Date.now()).subscription.length,0);
});
test('concurrent callers share one paid call; durable cached results survive a restart',async()=>{
 const f=fixture();const [one,two]=await Promise.all([f.service.get(278),f.service.get(278)]);
 assert.equal(one,two);assert.equal(f.calls.length,2);assert.equal(f.records.get('budget.json').credits,2);
 assert.equal(f.calls[1].config.headers['X-API-Key'],'test-key');assert.deepEqual(f.calls[1].config.params,{regions:'US'});
 assert.equal((await createWatchmodeService(f.args).get(278)).source,'watchmode');assert.equal(f.calls.length,2);
 f.advance(CACHE_TTL+1);await createWatchmodeService(f.args).get(278);assert.equal(f.calls.length,4);
});
test('daily reservations persist through restart and cache hits still work at the limit',async()=>{
 const f=fixture({dailyCredits:2});await f.service.get(278);
 const restarted=createWatchmodeService(f.args);assert.equal(await restarted.get(679),null);assert.equal(f.calls.length,2);
 assert.equal((await restarted.get(278)).source,'watchmode');
 f.advance(86400000);assert.equal((await createWatchmodeService(f.args).get(679)).source,'watchmode');assert.equal(f.records.get('budget.json').credits,2);
});
test('account quota is checked before paid calls and a malformed status fails closed',async()=>{
 for (const status of [{quota:2500,quotaUsed:1999},{quota:1,quotaUsed:0},{quota:2500},{}]) {
  const f=fixture();f.args.httpClient.get=async(url)=>{f.calls.push(url);return {data:status};};
  assert.equal(await f.service.get(278),null);assert.equal(f.calls.length,1);assert.equal(f.records.has('budget.json'),false);
 }
});
test('storage failure prevents spending; upstream failures are bounded and leave fallback usable',async()=>{
 const f=fixture();f.store.set=async()=>{throw Error('unavailable');};assert.equal(await f.service.get(278),null);assert.equal(f.calls.length,1);
 const g=fixture();g.args.httpClient.get=async url=>{g.calls.push(url);if(url.includes('/status/'))return {data:{quota:2500,quotaUsed:0}};throw {response:{status:429}};};
 assert.equal(await g.service.get(278),null);assert.equal(g.records.get('budget.json').credits,2);
 assert.equal(await g.service.get(278),null);assert.equal(await g.service.get(679),null);assert.equal(g.calls.length,2);
});
test('invalid IDs and missing credentials never call the upstream API',async()=>{
 const f=fixture();for(const id of ['foo',-1,0,2.2,2147483648])assert.equal(await f.service.get(id),null);
 assert.equal(await createWatchmodeService({...f.args,apiKey:''}).get(278),null);assert.equal(f.calls.length,0);
});
test('browser route rejects cross-site requests, crawlers and invalid IDs without spending credits',async()=>{
 let handler,calls=0;installWatchmodeRoutes({post:(_path,fn)=>{handler=fn;}},{service:{enabled:true,get:async()=>{calls++;return {source:'watchmode'};}},movieExists:async()=>true});
 const res=()=>({code:200,set(){return this;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
 const req=(id,origin,ua='Mozilla/5.0')=>({params:{id},headers:{origin,'user-agent':ua},ip:'test'});
 const foreign=res();await handler(req('278','https://elsewhere.example'),foreign);assert.equal(foreign.code,403);
 const bot=res();await handler(req('278','https://reelbot.movie','Googlebot'),bot);assert.equal(bot.body.availability,null);
 const bad=res();await handler(req('278oops','https://reelbot.movie'),bad);assert.equal(bad.code,400);
 assert.equal(calls,0);const good=res();await handler(req('278','https://reelbot.movie'),good);assert.equal(calls,1);assert.equal(good.body.availability.source,'watchmode');
});
