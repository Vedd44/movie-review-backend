const { randomBytes } = require('node:crypto');
const SHARE_ID = /^[A-Za-z0-9_-]{12}$/;
const BUCKET = 'reelbot-shared-picks';
function normalizeSnapshot(body) {
 if (body?.v !== 1 || !Number.isSafeInteger(body.id) || body.id < 1 || body.id > 2147483647) return null;
 if (typeof body.why !== 'string' || body.why.length > 1200 || !body.why.trim() || (body.brief != null && (typeof body.brief !== 'string' || body.brief.length > 500))) return null;
 return {v:1,id:body.id,why:body.why.trim(),brief:(body.brief || '').trim()};
}
function createSharedPickStore({baseUrl,serviceKey,httpClient}) {
 const enabled=Boolean(baseUrl && serviceKey && httpClient);
 const headers={apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'};
 let bucketReady;
 const config={headers,timeout:10000};
 async function ensureBucket() {
  if (!enabled) throw new Error('Shared pick storage is unavailable');
  if (!bucketReady) bucketReady=httpClient.post(`${baseUrl}/storage/v1/bucket`,{id:BUCKET,name:BUCKET,public:false,file_size_limit:8192,allowed_mime_types:['application/json']},config).catch(error=>{
    const data=error.response?.data;
    if (String(data?.statusCode || error.response?.status)==='409' || /already exists/i.test(data?.message || data?.error || '')) return;
    bucketReady=null;throw error;
  });
  await bucketReady;
 }
 return {enabled,async create(snapshot) {
   await ensureBucket();
   const token=randomBytes(9).toString('base64url');
   await httpClient.post(`${baseUrl}/storage/v1/object/${BUCKET}/${token}.json`,JSON.stringify(snapshot),{...config,headers:{...headers,'x-upsert':'false'}});
   return token;
  },async get(token) {
   if (!SHARE_ID.test(token)) return null;
   if (!enabled) throw new Error('Shared pick storage is unavailable');
   try {const response=await httpClient.get(`${baseUrl}/storage/v1/object/${BUCKET}/${token}.json`,config);return normalizeSnapshot(response.data);}
   catch(error) {if (error.response?.status===404 || String(error.response?.data?.statusCode)==='404' || error.response?.data?.code==='NoSuchKey') return null;throw error;}
  }};
}
function installSharedPickRoutes(app,{store,movieExists,now=Date.now}) {
 const recent=new Map();
 app.post('/reelbot/shares',async(req,res)=>{
  const snapshot=normalizeSnapshot(req.body);
  if (!snapshot) return res.status(400).json({error:'This pick could not be shared. Please try again.'});
  const key=String(req.headers['x-forwarded-for'] || req.ip || 'guest').split(',')[0].trim();
  const time=now();let entry=recent.get(key);
  if (!entry || time-entry.start>60000) entry={start:time,count:0};
  if (entry.count>=30) return res.status(429).json({error:'Please wait a moment before sharing another pick.'});
  entry.count++;recent.set(key,entry);if(recent.size>2000)recent.delete(recent.keys().next().value);
  try {
   if (!await movieExists(snapshot.id)) return res.status(404).json({error:'Movie not found'});
   const token=await store.create(snapshot);
   res.setHeader('Cache-Control','no-store');return res.status(201).json({token,path:`/p/${token}`});
  } catch {return res.status(503).json({error:'Sharing is temporarily unavailable. Your pick is still here.'});}
 });
 app.get('/reelbot/shares/:token',async(req,res)=>{
  if(!SHARE_ID.test(req.params.token))return res.status(404).json({error:'Shared pick not found'});
  try {const snapshot=await store.get(req.params.token);if(!snapshot)return res.status(404).json({error:'Shared pick not found'});
   res.setHeader('Cache-Control','public, max-age=3600');return res.json(snapshot);
  } catch {return res.status(503).json({error:'This shared pick is temporarily unavailable.'});}
 });
}
module.exports={SHARE_ID,normalizeSnapshot,createSharedPickStore,installSharedPickRoutes};
