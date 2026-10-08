const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { getCommittedPrompt, canReuseIntentSnapshot } = require('../src/ask/requestContinuity');
let checks = 0;
for (const prompt of ['Movie after a shift at a restaurant', 'Movie where people work late at a food place', 'Smart science fiction under 100 minutes', '', 'Movies like Heat, no horror']) {
  for (const draft of ['', 'A different draft', prompt]) {
    const p = { prompt: draft, original_prompt: prompt, is_swap: true, intent_snapshot: {raw_prompt: prompt} };
    assert.equal(getCommittedPrompt(p), prompt); checks++;
    assert.equal(canReuseIntentSnapshot(p, prompt), true); checks++;
    assert.equal(getCommittedPrompt({...p,is_swap:false}), draft); checks++;
    assert.equal(canReuseIntentSnapshot({...p,is_swap:false},draft), false); checks++;
  }
}
assert.equal(getCommittedPrompt({prompt:'',is_swap:true,intent_snapshot:{raw_prompt:'Same request'}}),'Same request'); checks++;
assert.equal(canReuseIntentSnapshot({is_swap:true,intent_snapshot:{raw_prompt:'Old request'}},'New request'),false); checks++;
const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
const context = vm.createContext({console, Set, Math});
const start = source.indexOf('const appendUnique =');
const end = source.indexOf('const hydrateResolvedIntent', start);
vm.runInContext(source.slice(start,end) + '\nthis.refine = applyRefinementToIntent;', context);
for (const runtime of [81,97,120,181]) {
  const intent = {raw_prompt:'Workers in a restaurant', plot_constraints:['food workplace'], hard_filters:{max_runtime_minutes:150}};
  const result = context.refine(intent,{id:'shorter',source_movie_runtime:runtime});
  assert.equal(result.hard_filters.max_runtime_minutes, Math.min(150,runtime-1)); checks++;
  assert.equal(result.raw_prompt,intent.raw_prompt); checks++;
  assert.deepEqual(Array.from(result.plot_constraints), intent.plot_constraints); checks++;
  assert.equal(intent.hard_filters.max_runtime_minutes,150); checks++;
}
for (const id of ['lighter','darker','shorter','funnier','less_intense','more_like_this','different_angle']) {
  const result = context.refine({raw_prompt:'Diner workers overnight', plot_constraints:['diner','workers','night'], hard_filters:{max_runtime_minutes:100, min_release_year:1990}}, {id});
  assert.equal(result.raw_prompt,'Diner workers overnight'); checks++;
  assert.deepEqual(Array.from(result.plot_constraints),['diner','workers','night']); checks++;
  assert.equal(result.hard_filters.max_runtime_minutes,100); checks++;
  assert.equal(result.hard_filters.min_release_year,1990); checks++;
}
const { parseReelbotIntent } = require('../ai/intentParser');
const { passesRecommendationContract } = require('../ai/recommendationContract');
const adult = parseReelbotIntent('A Sunday night feel good movie for adults');
for (const id of ['lighter','less_intense','funnier']) {
  const refined = context.refine(adult,{id});
  assert.equal(passesRecommendationContract({genre_ids:[16,10751,35],runtime:90}, refined),false); checks++;
  assert.equal(passesRecommendationContract({genre_ids:[35,18],runtime:90}, refined),true); checks++;
}
const { buildAnchoredRecommendationPrompt, updateConversationForPrompt, buildContextualRecommendationPrompt } = require('../src/ask/conversationState');
for (const original of ['Movie where people work late night at a food place','A smart sci-fi movie under 100 minutes','Something comforting for adults']) {
 for (const intent of ['NEXT_RECOMMENDATION','REFINE_RECOMMENDATION']) {
  assert.equal(buildAnchoredRecommendationPrompt(original,{intent,anchorTitle:'The Last Shift',latestPrompt:'another'}),original); checks++;
 }
}
assert.equal(buildAnchoredRecommendationPrompt('something like this',{intent:'MOVIE_RECOMMENDATION',anchorTitle:'Heat',latestPrompt:'something like this'}),'something like Heat');checks++;
assert.equal(buildAnchoredRecommendationPrompt('Something else',{intent:'MOVIE_RECOMMENDATION',anchorTitle:'Heat'}),'Something else');checks++;
const newState = updateConversationForPrompt({activeRequest:'A short comedy',activeConstraints:{maxRuntime:89,minYear:2020},userCorrections:['shorter']},'A sweeping epic over two hours','GENERAL_RECOMMENDATION');
assert.equal(newState.activeConstraints.maxRuntime,undefined);checks++;
assert.equal(newState.activeConstraints.minYear,undefined);checks++;
assert.equal(newState.userCorrections.length,0);checks++;
assert.equal(newState.activeRequest,'A sweeping epic over two hours');checks++;
const {retainPlotRankingEntries}=require('../src/ask/plotClues');
const popular=Array.from({length:30},(_,i)=>({movie:{id:i+1},score:100-i}));
const clue={movie:{id:1000,plot_discovered:true},score:1};
const curated=popular.slice(0,22);
assert.equal(retainPlotRankingEntries([...popular,clue],curated)[0].movie.id,1000);checks++;
assert.equal(retainPlotRankingEntries([...popular,clue],curated).length,22);checks++;
assert.deepEqual(retainPlotRankingEntries(popular,curated),curated);checks++;
assert.equal(retainPlotRankingEntries([clue],[clue,...curated]).filter(e=>e.movie.id===1000).length,1);checks++;
assert.equal(retainPlotRankingEntries(popular,curated).some(e=>e.movie.id===1000),false);checks++;
console.log(`${checks} request continuity, fresh-request isolation, clue retention and relative refinement checks passed.`);
