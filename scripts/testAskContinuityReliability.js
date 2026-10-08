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
