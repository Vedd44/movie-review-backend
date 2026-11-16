const assert = require('node:assert/strict');
const {classifyAskIntent,ASK_INTENTS:I}=require('../src/ask/askIntent');
const {updateConversationForPrompt,getConversationExcludedIds}=require('../src/ask/conversationState');
const state={activeRequest:'An adult sci-fi thriller under 100 minutes, no horror',activeIntent:I.GENERAL_RECOMMENDATION,anchorMovie:{id:1,title:'First'},recommendationHistory:[{id:1,title:'First',status:'recommended'},{id:2,title:'Second',status:'recommended'}]};
let checks=0;
for(const page of ['home','browse','movie_detail','general']) {
 for(const prompt of ["I've seen it",'I already watched this','I have already watched that movie','Seen this already','Already seen that',"I've seen this before", "I've seen it, another one please.", "I've seen it, another one?", "I've seen it. Could you give me another movie?", "I've seen it. Give me another movie.", 'I’ve already seen this'   ]) {
  const intent=classifyAskIntent({prompt,context:{page},conversation:state});
  assert.equal(intent,I.REFINE_RECOMMENDATION,`${page}: ${prompt}`);
  const next=updateConversationForPrompt(state,prompt,intent);
  assert.equal(next.activeRequest,state.activeRequest);
  assert.equal(next.recommendationHistory[0].status,'rejected');
  assert.equal(next.recommendationHistory[1].status,'recommended');
  assert.deepEqual(getConversationExcludedIds(next,{allowRewatch:true}),[1]); checks+=5;
 }
 for(const prompt of ["I've seen it. Who directed it?",'I watched this, can you explain the ending?',"I've seen it; is it based on a book?","I've seen it. When was it released?", "I've seen it. Where was it filmed?", "I've seen it... who directed it?", "I've seen it, but who directed it?", "I've seen it. Who plays another character?", "I've seen it. Why did you pick it?", "I've seen it and who directed it?", 'I have seen that movie. Why is it so scary?'   ]) {
  const intent=classifyAskIntent({prompt,context:{page},conversation:state});
  assert.equal(intent,I.CURRENT_MOVIE_QUESTION,`${page}: ${prompt}`);
  const next=updateConversationForPrompt(state,prompt,intent);
  assert.deepEqual(next.recommendationHistory,state.recommendationHistory);
  assert.equal(next.activeRequest,state.activeRequest); checks+=3;
 }
}
for(const prompt of ['I have not seen this',"I haven't watched it",'Have I seen this?','I have seen this actor before',"I've seen Alien",'I have seen "It"']) {
 assert.deepEqual(updateConversationForPrompt(state,prompt,I.REFINE_RECOMMENDATION).recommendationHistory,state.recommendationHistory,prompt); checks++;
}
for(const page of ['home','movie_detail']) {
 const context=page==='home'?{page,currentPick:{id:3,title:'Page film'},originalPrompt:state.activeRequest}:{page,movie:{id:3,title:'Page film'}};
 const intent=classifyAskIntent({prompt:'I already watched this',context});
 assert.equal(intent,I.REFINE_RECOMMENDATION);
 assert.deepEqual(getConversationExcludedIds(updateConversationForPrompt({},'I already watched this',intent,context),{allowRewatch:true}),[3]);checks+=2;
}
const fresh='Start fresh: a romantic comedy';
assert.deepEqual(updateConversationForPrompt(state,fresh,classifyAskIntent({prompt:fresh,conversation:state})).recommendationHistory,[]);checks++;


for (const prompt of ["I've seen it. Can you recommend a comedy?", "I've seen it. Could you give me another movie?"]) {
 assert.match(classifyAskIntent({prompt,conversation:state}), /RECOMMENDATION/); checks++;
}

console.log(`${checks} seen-feedback assertions passed.`);
