const { randomUUID, createHash } = require('node:crypto');
const { TAKE_VERSION, validTake } = require('./take');
const { hasSpoilerWarning, SOURCES, parseFeed, selectStories } = require('./feed');
function publicSnapshot(snapshot) {
 const items = (snapshot?.items || []).filter(x => x && !hasSpoilerWarning(x) && x.takeVersion===TAKE_VERSION && validTake(x.take)).slice(0,25).map(x => Object.fromEntries(['id','headline','summary','take','sourceName','sourceUrl','publishedAt','editorialReviewedAt','author'].map(k => [k,x[k] || ''])));
 return {version:1,updatedAt:snapshot?.updatedAt || null,items};
}
function createNewsService({ store, httpClient, generateTake, clock=Date.now, enabled=true, logger=console }) {
 let cached=null, readAt=0, running=false, lastWake=0;
 async function read() {
  if (cached && clock()-readAt<60000) return publicSnapshot(cached);
  try { const fresh=await store?.read(); if(fresh){cached=fresh;readAt=clock();} } catch { if(!cached)throw Error('news_unavailable'); }
  if(!cached)throw Error('news_unavailable');
  return publicSnapshot(cached);
 }
 async function refresh() {
  if (!enabled || !store || running) return {status:'disabled_or_busy'};
  running=true; const token=randomUUID(); let claimed=false;
  try {
   const previous=await store.claim(token); if(!previous)return {status:'not_due'}; claimed=true;
   const feeds=await Promise.allSettled(SOURCES.map(async source=>{
    const response=await httpClient.get(source.url,{timeout:12000,maxContentLength:2000000,maxBodyLength:2000000,maxRedirects:0,responseType:'text',headers:{'User-Agent':'ReelBot-News/1.0 (+https://reelbot.movie/news)','Accept':'application/rss+xml,application/xml,text/xml'}});
    return parseFeed(response.data,source,clock());
   }));
   const fresh=feeds.flatMap(r=>r.status==='fulfilled'?r.value:[]);
   if(!fresh.length){await store.finish(token,null);return {status:'feeds_unavailable'};}
   const existing=new Map([...(previous.cache||[]),...(previous.items||[])].map(x=>[x.id,x]));
   const candidates=selectStories([...fresh,...(previous.items||[])].filter(x=>!hasSpoilerWarning(x)),25); const items=[]; const attempts=[];
   for(const story of candidates){
    const old=existing.get(story.id);
    if(old?.takeVersion===TAKE_VERSION && validTake(old?.take) && old.headline===story.headline && old.summary===story.summary){items.push({...story,take:old.take,takeVersion:TAKE_VERSION,editorialReviewedAt:old.editorialReviewedAt});continue;}
    if(old?.takeVersion===TAKE_VERSION && old?.attemptedAt && old.headline===story.headline && old.summary===story.summary)continue;
    const storyKey=createHash('sha256').update(JSON.stringify([TAKE_VERSION,story.id,story.headline,story.summary])).digest('hex');
    const reserved=await store.reserve(token,storyKey);
    if(validTake(reserved?.take)){items.push({...story,take:reserved.take,takeVersion:TAKE_VERSION,editorialReviewedAt:reserved.reviewedAt});continue;}
    const reservation=reserved?.reservation; if(!reservation)continue;
    attempts.push({...story,takeVersion:TAKE_VERSION,attemptedAt:new Date(clock()).toISOString()});
    try {
     const result=await generateTake(story);
     if(result?.cost!==null && Number.isInteger(result?.cost))await store.settle(token,reservation,result.cost,result.take);
     if(validTake(result?.take))items.push({...story,take:result.take,takeVersion:TAKE_VERSION,editorialReviewedAt:new Date(clock()).toISOString()});
    } catch { /* Ambiguous calls keep the full reservation. No retry or model fallback. */ }
   }
   const output=selectStories([...items,...(previous.items||[]).filter(x=>!hasSpoilerWarning(x) && x.takeVersion===TAKE_VERSION && validTake(x.take))],25);
   if(!output.length && (previous.items||[]).length){await store.finish(token,null);return {status:'no_publishable_stories'};}
      const cache=Array.from(new Map([...(previous.cache||[]),...(previous.items||[]),...attempts,...items].map(x=>[x.id,x])).values()).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,200);
   const updated=Math.max(Date.parse(previous.updatedAt)||0,...items.map(x=>Date.parse(x.editorialReviewedAt)||0));
   const snapshot={version:1,updatedAt:updated?new Date(updated).toISOString():null,items:output,cache};
   const saved=await store.finish(token,snapshot); if(!saved)throw Error('lease_lost');
   cached=snapshot;readAt=clock(); logger.info('Movie news refreshed',{items:output.length,sources:feeds.filter(r=>r.status==='fulfilled').length});
   return {status:'updated',items:output.length};
  } catch { if(claimed){try{await store.finish(token,null);}catch{}} logger.warn('Movie news refresh unavailable'); return {status:'unavailable'}; }
  finally {running=false;}
 }
 function wake(){if(clock()-lastWake<60000)return;lastWake=clock();void refresh();}
 function start(){ const initial=setTimeout(()=>void refresh(),10000);initial.unref();const timer=setInterval(()=>void refresh(),60000);timer.unref();return()=>{clearTimeout(initial);clearInterval(timer);}; }
 return {read,refresh,start,wake};
}
module.exports={publicSnapshot,createNewsService};
