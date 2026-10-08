const assert=require('node:assert/strict');
const {classifyAskIntent,ASK_INTENTS:I}=require('../src/ask/askIntent');
const {updateConversationForPrompt,buildContextualRecommendationPrompt,getConversationExcludedIds,buildAnchoredRecommendationPrompt}=require('../src/ask/conversationState');
for(const prompt of ['Find me a warm romantic comedy for adults','A movie about a woman receiving messages from the future']) {
 const context={page:'movie_detail',movie:{id:1,title:'Alien'}};
 const intent=classifyAskIntent({prompt,context});
 assert.match(intent,/RECOMMENDATION/,'A complete new movie request on a detail page is a recommendation');
 assert.equal(buildAnchoredRecommendationPrompt(prompt,{intent,anchorTitle:'Alien',latestPrompt:prompt}),prompt,'A new request must not acquire an unrequested similarity anchor');
}
const initial={activeRequest:'An adult sci-fi thriller, no horror',activeIntent:I.GENERAL_RECOMMENDATION,activeConstraints:{maxRuntime:95,hardExclusions:['no_horror']},userCorrections:['shorter'],anchorMovie:{id:1,title:'Previous',runtime:90},recommendationHistory:[{id:1,status:'recommended'}]};
assert.equal(updateConversationForPrompt(initial,'Start fresh: a shorter romantic comedy',I.GENERAL_RECOMMENDATION).activeConstraints.maxRuntime,undefined,'A fresh request cannot derive a cap from the previous topic');
for(const prompt of ['Is this scary?','Who directed it?','Is it shorter than two hours?']) {
 assert.equal(classifyAskIntent({prompt,conversation:initial}),I.CURRENT_MOVIE_QUESTION,prompt);
 const answered=updateConversationForPrompt(initial,prompt,I.CURRENT_MOVIE_QUESTION);
 assert.deepEqual(answered.activeConstraints,initial.activeConstraints,'A movie question must preserve recommendation constraints');
 assert.deepEqual(answered.userCorrections,initial.userCorrections);
 const next=updateConversationForPrompt(answered,'Another',I.NEXT_RECOMMENDATION);
 assert.match(buildContextualRecommendationPrompt('Another',next,I.NEXT_RECOMMENDATION),/No longer than 95/);
}
for(const prompt of ['New topic: a sweeping historical epic','Actually, start fresh: a romantic comedy','Forget that request. Find me a family adventure']) {
 const intent=classifyAskIntent({prompt,conversation:initial});
 assert.equal(intent,I.GENERAL_RECOMMENDATION,prompt);
 const fresh=updateConversationForPrompt(initial,prompt,intent);
 assert.equal(fresh.activeRequest,prompt);
 assert.equal(fresh.activeConstraints.maxRuntime,undefined);
 assert.deepEqual(fresh.userCorrections,[]);
 assert.deepEqual(getConversationExcludedIds(fresh),[],'Old primary picks are not fresh-request exclusions');
}
let state=updateConversationForPrompt(initial,'shorter',I.REFINE_RECOMMENDATION);
assert.equal(state.activeConstraints.maxRuntime,89);
state.anchorMovie={id:2,title:'Next',runtime:85};
state=updateConversationForPrompt(state,'Another',I.NEXT_RECOMMENDATION);
assert.equal(state.activeConstraints.maxRuntime,89);
state=updateConversationForPrompt(state,'shorter',I.REFINE_RECOMMENDATION);
assert.equal(state.activeConstraints.maxRuntime,84);
console.log('Ask questions preserve constraints; explicit topic changes isolate history; repeated shorter remains relative.');
const {parseReelbotIntent}=require('../ai/intentParser');
const base={...initial,activeRequest:'A sci-fi thriller, no horror, under 100 minutes',activeConstraints:{},userCorrections:[]};
for(const page of ['home','browse','movie_detail','general']) {
 for(const prompt of ['Another pick please','Another under 90 minutes','One more, but no horror','Something else','Make it under 90 minutes']) {
  const intent=classifyAskIntent({prompt,context:{page},conversation:base});
  assert.match(intent,/^(?:NEXT|REFINE)_RECOMMENDATION$/,`${page}: ${prompt}`);
  const next=updateConversationForPrompt(base,prompt,intent);
  const effective=buildContextualRecommendationPrompt(prompt,next,intent);
  const parsed=parseReelbotIntent(effective);
  assert.ok(parsed.hard_filters.required_genre_ids.includes(878));
  assert.ok(parsed.hard_filters.exclude_genre_ids.includes(27));
  assert.equal(parsed.hard_filters.max_runtime_minutes,prompt.includes('90')?89:99);
  assert.deepEqual(getConversationExcludedIds(next),[1]);
 }
}
for(const [prompt,cap] of [['Actually, under 90 minutes',89],['Actually, under 110 minutes instead',109]]) {
 const intent=classifyAskIntent({prompt,conversation:base});
 const next=updateConversationForPrompt(base,prompt,intent);
 assert.equal(next.activeConstraints.maxRuntime,cap);
 assert.equal(parseReelbotIntent(buildContextualRecommendationPrompt(prompt,next,intent)).hard_filters.max_runtime_minutes,cap);
 const again=updateConversationForPrompt(next,'Another',I.NEXT_RECOMMENDATION);
 assert.equal(parseReelbotIntent(buildContextualRecommendationPrompt('Another',again,I.NEXT_RECOMMENDATION)).hard_filters.max_runtime_minutes,cap);
}
const identified={activeIntent:I.MOVIE_IDENTIFICATION,activeRequest:'What was that movie where a man uses tattoos?',anchorMovie:{id:77,title:'Memento'}};
const stricterBase={...base,activeRequest:'A sci-fi thriller under 80 minutes, no horror',anchorMovie:{id:1,runtime:90}};
const shorter=updateConversationForPrompt(stricterBase,'shorter',I.REFINE_RECOMMENDATION);
assert.equal(shorter.activeConstraints.maxRuntime,79,'Relative shorter preserves a stricter cap from the original request');
const answeredIdentification=updateConversationForPrompt(identified,'Is it scary?',I.CURRENT_MOVIE_QUESTION);
assert.equal(classifyAskIntent({prompt:'He used Polaroid photographs too.',conversation:answeredIdentification}),I.MOVIE_IDENTIFICATION);
assert.equal(classifyAskIntent({prompt:'Actually, start fresh: a romantic comedy',conversation:identified}),I.GENERAL_RECOMMENDATION);
