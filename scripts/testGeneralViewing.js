const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {parseReelbotIntent}=require('../ai/intentParser');
const {getRecommendationFitBreakdown}=require('../ai/recommendationScoring');
const {resolveExpandedRecommendationCandidates,buildRecommendationRetrievalPlan}=require('../ai/recommendationRetrieval');
const {passesRecommendationContract}=require('../ai/recommendationContract');
const movie={id:1,title:'Example',genre_ids:[35],vote_average:7.5,vote_count:300,popularity:30,runtime:90,release_date:'1985-01-01'};
const signals={kid_friendliness:0,consensus_friendliness:.5,confusion_risk:0,scariness:0,peril:0};
for (const prompt of ["Something that'll make me laugh",'A psychological thriller',"Something that'll keep me guessing",'A movie with an intricate story']) {
 const intent=parseReelbotIntent(prompt);
 assert.equal(intent.audience_age,null);
 const adult=getRecommendationFitBreakdown(movie,intent,{},signals);
 const child=getRecommendationFitBreakdown(movie,intent,{},{...signals,kid_friendliness:1});
 assert.equal(adult.total,child.total,'Child-friendliness alone must not boost a general request');
 assert.equal(child.components.low_regret,0,'Low-regret assumptions must not flatten a requested experience');
}
for (const prompt of ['A family movie for children','A gentle movie for my five-year-old']) {
 const intent=parseReelbotIntent(prompt);
 assert.ok(intent.guardrails.child_family_safe);
 assert.ok(getRecommendationFitBreakdown(movie,intent,{},{...signals,kid_friendliness:1,toddler_friendliness:1}).total > getRecommendationFitBreakdown(movie,intent,{},{...signals,toddler_friendliness:0}).total,'Explicit child context retains audience preference');
}
const mystery=parseReelbotIntent("Something that'll keep me guessing");
assert.ok(mystery.preferred_genre_ids.includes(9648));
assert.ok(!mystery.hard_filters.required_genre_ids.includes(9648),'Experience inference remains soft, not a hard genre constraint');
assert.ok(passesRecommendationContract({...movie,genre_ids:[16,35]},parseReelbotIntent('Something funny'),{final:true}),'Animation remains eligible');
assert.ok(!passesRecommendationContract({...movie,genre_ids:[16,35]},parseReelbotIntent('A comedy, no animation'),{final:true}));
for(const phrase of ["Something I've never heard of",'An overlooked gem','An under-the-radar film']) assert.ok(buildRecommendationRetrievalPlan(parseReelbotIntent(phrase)).lesser_known);
assert.equal(buildRecommendationRetrievalPlan(parseReelbotIntent('Nothing obscure')).lesser_known,false);
const source=fs.readFileSync(require.resolve('../index.js'),'utf8');
const context=vm.createContext({getMovieEraBucket:movie=>movie.era});
vm.runInContext(source.slice(source.indexOf('const balanceCandidatesByEra'),source.indexOf('const BEHAVIOR_LANE_GENRE_MAP'))+'\nthis.balance=balanceCandidatesByEra;',context);
const ranked=['recent','2010s','2000s','1990s','older'].flatMap((era,i)=>Array.from({length:10},(_,j)=>({movie:{id:i*10+j,era},score:100-i*10-j})));
const selected=context.balance(ranked,22);
assert.equal(selected.length,22);
for(const era of ['recent','2010s','2000s','1990s','older']) assert.ok(selected.filter(e=>e.movie.era===era).length>=4,'No era crowded out by an overfull recent-first quota');
assert.ok(selected.every((e,i)=>!i || e.score<=selected[i-1].score),'Model sees relevance order, not mandatory recent-first order');
assert.equal(context.balance(ranked.filter(e=>e.movie.era==='older'),22).length,10,'No filler or duplicate candidates');
(async()=>{
 for(const prompt of ["Something I've never heard of",'A funny movie']) {
  const calls=[];
  const found=await resolveExpandedRecommendationCandidates({intent:parseReelbotIntent(prompt),fetchTmdb:async(endpoint,params)=>{calls.push({endpoint,params});return {results:[{...movie,vote_count:80,popularity:1}]};},fetchStructuredMoviesByIds:async()=>[{...movie,vote_count:80,popularity:1}],normalizeStructuredCandidate:(m,meta={})=>({...m,...meta})});
  assert.equal(calls.length,3,'Three existing catalog calls, no extra retrieval dependency');
  assert.ok(calls.every(c=>c.endpoint==='/discover/movie'));
  if(prompt.includes('heard')) {
   assert.equal(found.length,1,'Credible lesser-known films survive popularity-biased admission');
   assert.ok(calls.every(c=>c.params['vote_count.lte']===1500&&c.params['vote_count.gte']===50));
  } else {
   assert.ok(calls.some(c=>c.params['vote_count.lte']===10000 && c.params['vote_count.gte']===1000),'Complementary catalog source supplies established alternatives to popular feeds');
  }
 }
 console.log('General audience neutrality, explicit child context, soft mystery cues, discovery admission and bounded era/catalog diversity passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});

const {deriveMovieSignals}=require('../ai/movieSignals');
const compactContext=vm.createContext({deriveMovieSignals,getRecommendationFitBreakdown,getMovieEraBucket:()=> 'older',getMovieSignalScore:()=>10,hasDescriptivePlotRequest:()=>false,truncateText:(value,limit)=>value.slice(0,limit)});
vm.runInContext(source.slice(source.indexOf('const buildCompactCandidate'),source.indexOf('const safeJsonParse'))+'\nthis.compact=buildCompactCandidate;',compactContext);
const animated={...movie,genre_ids:[16,35,10751],genre_names:['Animation','Comedy','Family'],overview:'A comic adventure.'};
const generalCandidate=compactContext.compact(animated,parseReelbotIntent('A funny movie'));
assert.equal(generalCandidate.derived_signals.kid_friendliness,undefined,'Unrequested child hints must not prime model selection');
assert.equal(generalCandidate.derived_signals.toddler_friendliness,undefined);
assert.ok(!generalCandidate.derived_signals.practical_watch_fit.includes('family_safe'));
assert.deepEqual(generalCandidate.genres,animated.genre_names,'Actual genre evidence remains visible; animation is not hidden or excluded');
assert.ok(Number.isFinite(compactContext.compact(animated,parseReelbotIntent('A family movie for children')).derived_signals.kid_friendliness));

const qualityContext=vm.createContext({pickSurfaceTally:new Map(),OVEREXPOSED_PICK_TITLES:new Set()});
vm.runInContext(source.slice(source.indexOf('const getExposurePenalty ='),source.indexOf('const balanceCandidatesByEra'))+'\nthis.exposure=getExposurePenalty;this.quality=getQualityFitBoost;',qualityContext);
assert.equal(qualityContext.exposure({...movie,release_date:'1950-01-01'}),qualityContext.exposure({...movie,release_date:'2025-01-01'}),'Age alone is not overexposure');
assert.equal(qualityContext.quality({...movie,release_date:'1950-01-01'}),qualityContext.quality({...movie,release_date:'2025-01-01'}),'Release year alone is not quality');

const {buildPickDecisionPrompts}=require('../ai/promptBuilders/homepagePick');
const childPrompts=buildPickDecisionPrompts({preferences:{prompt:'A gentle movie for my five-year-old, nothing scary'},intent:parseReelbotIntent('A gentle movie for my five-year-old, nothing scary'),candidates:[animated]});
assert.match(childPrompts.systemPrompt,/absence of a warning in a synopsis is not evidence of absence/);
const generalPrompts=buildPickDecisionPrompts({preferences:{prompt:'A funny movie'},intent:parseReelbotIntent('A funny movie'),candidates:[animated]});
assert.match(generalPrompts.userPrompt,/Viewing audience: General adult viewing/);
assert.doesNotMatch(generalPrompts.systemPrompt,/For explicit child-safety requirements,/);
