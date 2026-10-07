const test=require('node:test');const assert=require('node:assert/strict');
const {createWatchmodeStore}=require('./store');
test('creates only a private cache bucket and deletes expired data through Storage API',async()=>{
 const calls=[];let exists=false;
 const httpClient={get:async url=>{calls.push(['get',url]);if(url.includes('/bucket/')){if(!exists)throw {response:{status:404}};return {data:{public:false}};}throw {response:{status:400,data:{message:'Object not found'}}};},post:async(url,data,config)=>{calls.push(['post',url,data,config]);if(url.endsWith('/bucket'))exists=true;if(url.includes('/object/list/'))return {data:[{name:'movie-278-US.json',updated_at:'2026-09-01'},{name:'movie-679-US.json',updated_at:'2026-10-06'},{name:'budget.json',updated_at:'2026-09-01'}]};return {data:{}};},delete:async(url,config)=>{calls.push(['delete',url,config]);}};
 const store=createWatchmodeStore({baseUrl:'https://example.supabase.co',serviceKey:'private',httpClient,now:()=>Date.parse('2026-10-07')});
 assert.equal(await store.get('movie-278-US.json'),null);await store.set('movie-278-US.json',{availability:{}});assert.equal(await store.prune(),1);
 const bucket=calls.find(c=>c[1].endsWith('/bucket'));assert.equal(bucket[2].public,false);
 const removed=calls.find(c=>c[0]==='delete');assert.deepEqual(removed[2].data,{prefixes:['movie-278-US.json']});
 await assert.rejects(()=>store.get('../some-other-bucket.json'));
});
test('an existing public bucket is rejected before reading or writing provider data',async()=>{
 const store=createWatchmodeStore({baseUrl:'https://example.supabase.co',serviceKey:'private',httpClient:{get:async()=>({data:{public:true}})}});
 await assert.rejects(()=>store.get('budget.json'),/private/);
});
