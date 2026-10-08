const assert=require('node:assert/strict');
const {fetchSemanticKeywordCandidates}=require('../src/ask/semanticKeywordRetrieval');
const {passesRecommendationContract}=require('../ai/recommendationContract');
(async()=>{
 const requests=[];let terms;
 const hard={min_release_year:1985,max_release_year:1995,min_runtime_minutes:40,max_runtime_minutes:89,required_genre_ids:[878,53],exclude_genre_ids:[27,16],genre_match:'all'};
 const film={id:7,title:'A catalogue candidate absent from title hypotheses',poster_path:'/p.jpg',overview:'An established story premise.'};
 const results=await fetchSemanticKeywordCandidates(['setting','activity','relationship','ignored'],hard,{today:'2026-10-08',resolveKeywordIds:async seeds=>{terms=seeds;return [{id:11,score:120},{id:12,score:120},{id:13,score:40}];},fetchTmdb:async(path,params)=>{requests.push({path,params});return {results:[film,film,{...film,id:8,adult:true}]};}});
 assert.deepEqual(terms,['setting','activity','relationship']);assert.deepEqual(results,[film]);assert.equal(requests.length,2);
 assert.deepEqual(requests.map(request=>request.params.with_keywords),['11,12','11|12'],'Explore combined relationships before broad recall within two catalogue calls');
 for(const {path,params} of requests){assert.equal(path,'/discover/movie');assert.equal(params['primary_release_date.gte'],'1985-01-01');assert.equal(params['primary_release_date.lte'],'1995-12-31');assert.equal(params['with_runtime.lte'],89);assert.equal(params['with_runtime.gte'],40);assert.equal(params.with_genres,'878,53');assert.equal(params.without_genres,'27,16');assert.equal(params.include_adult,'false');}
 assert.equal(passesRecommendationContract({...film,genre_ids:[878,53,27],runtime:80}, {hard_filters:hard},{final:true}),false,'Keyword recall never authorizes a factual exclusion mismatch');
 assert.equal(passesRecommendationContract({...film,genre_ids:[878,53],runtime:90}, {hard_filters:hard},{final:true}),false);
 let catalogCalls=0;
 assert.deepEqual(await fetchSemanticKeywordCandidates([],hard,{resolveKeywordIds:()=>{throw Error('must not search');}}),[]);
 assert.deepEqual(await fetchSemanticKeywordCandidates(['setting'],hard,{resolveKeywordIds:async()=>[{id:13,score:40}],fetchTmdb:async()=>{catalogCalls++;}}),[]);assert.equal(catalogCalls,0,'Related but nonexact keywords do not invent retrieval anchors');
 await assert.rejects(fetchSemanticKeywordCandidates(['setting'],hard,{resolveKeywordIds:async()=>{throw Error('keyword transport failure');}}),/keyword transport/);
 await assert.rejects(fetchSemanticKeywordCandidates(['setting'],hard,{resolveKeywordIds:async()=>[{id:11,score:120}],fetchTmdb:async()=>{throw Error('catalogue transport failure');}}),/catalogue transport/);
 const capped=await fetchSemanticKeywordCandidates(['setting'],{}, {resolveKeywordIds:async()=>[{id:11,score:120}],fetchTmdb:async()=>({results:Array.from({length:30},(_,id)=>({...film,id:id+1}))})});assert.equal(capped.length,18,'Preserve the bounded discovery and metadata budget');
 const retained=await fetchSemanticKeywordCandidates(['setting','activity'],{}, {resolveKeywordIds:async()=>[{id:11,score:120},{id:12,score:120}],fetchTmdb:async(path,params)=>({results:params.with_keywords.includes(',')?[{...film,id:99}]:Array.from({length:30},(_,id)=>({...film,id:id+1}))})});
 assert.equal(retained[0].id,99,'A combined-premise discovery survives the larger broad catalogue pool');assert.equal(retained.length,18);
 const searched=[];
 const phraseResults=await fetchSemanticKeywordCandidates(['mountain rescue workers','remote scientific station','mysterious research events'],{}, {resolveKeywordIds:async terms=>{searched.push(terms);return searched.length===1?[]:[{id:22,score:120}];},fetchTmdb:async()=>({results:[film]})});
 assert.deepEqual(searched,[['mountain rescue workers','remote scientific station','mysterious research events'],['mountain','scientific','mysterious']],'Unresolved phrase seeds receive at most one bounded atomic backoff, without a prompt-specific vocabulary');
 assert.deepEqual(phraseResults,[film]);
 console.log('Semantic keyword recall preserves two catalogue calls, exact keyword identity, hard filters and transport distinction.');
})().catch(error=>{console.error(error);process.exitCode=1;});
