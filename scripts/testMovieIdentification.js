const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {ASK_INTENTS,classifyAskIntent,isMovieIdentificationFollowUp}=require('../src/ask/askIntent');
const source=fs.readFileSync(require.resolve('../index.js'),'utf8');
let candidates=[{id:77,title:'Memento',release_date:'2000-10-11',overview:'A man unable to form new memories relies on photographs and tattoos.',poster_path:'/a.jpg'},{id:1824,title:'50 First Dates',release_date:'2004-02-13',overview:'A woman loses her memory each day.',poster_path:'/b.jpg'}];
let queries=['Memento','50 First Dates'],ranking={primary_id:77,alternative_ids:[1824],confidence:'medium',reason:'The photographs match, but waking each day is not an exact match.'},calls=[],searches=[];
const handlers={};
const context=vm.createContext({console,Date,Set,ASK_INTENTS,classifyAskIntent,isMovieIdentificationFollowUp,
 ...require('../src/ask/plotClues'),
 app:{post:(path,middleware,handler)=>handlers[path]=handler},timingMiddleware:()=>{},
 hasExplicitUserTrigger:()=>true,normalizeAskPageContext:x=>x,normalizeConversationState:x=>x,
 normalizePickMovie:(x,p,o)=>({...x,...o}),MODELS:{ask:'test'},
 dedupeMoviesById:list=>[...new Map(list.map(m=>[m.id,m])).values()],
 callStructuredOpenAI:async options=>{calls.push(options);return options.schemaName==='movie_identification_queries'?{search_queries:queries}:ranking;},
 fetchTmdb:async(path,params)=>{searches.push({path,...params});return {results:candidates};}
});
vm.runInContext(source.slice(source.indexOf('const movieIdentificationSchema'),source.indexOf('app.get("/movies/:id/reelbot"'))+'\nthis.identify=identifyMovieFromMemory;this.identificationPick=generateIdentificationPickPayload;',context);
(async()=>{
 let result=await context.identify('What was that movie where a guy wakes up every day with no memory?');
 assert.equal(calls.length,2,'retain the existing two model stages');assert.equal(searches.length,2);assert.ok(searches.every(x=>x.path==='/search/movie'),'no detail calls');
 assert.equal(result.primary.id,77);assert.equal(result.alternatives[0].id,1824);
 assert.equal(calls[0].schema.properties.search_queries.maxItems,4);assert.ok(calls[0].systemPrompt.includes('never plot keywords'));
 ranking={primary_id:77,alternative_ids:[77,1824,1824,999],confidence:'low',reason:'uncertain'};
 result=await context.identify('a vague memory');assert.equal(result.primary,null);assert.deepEqual(Array.from(result.alternatives,m=>m.id),[77,1824]);
 ranking={primary_id:999,alternative_ids:[999],confidence:'high',reason:'Invented title'};
 result=await context.identify('an invented plot');assert.equal(result.primary,null);assert.equal(result.confidence,'low');assert.equal(result.alternatives.length,0);
 queries=[];calls=[];searches=[];result=await context.identify('a man goes on a journey');assert.equal(calls.length,1);assert.equal(searches.length,0);assert.equal(result.primary,null);
 queries=['Memento'];ranking={primary_id:77,alternative_ids:[1824],confidence:'medium',reason:'The tattoo clue fits.'};
 let response;const res={json:x=>(response=x),status:()=>res,set:()=>{}};
 await handlers['/reelbot/ask']({body:{prompt:'What was that movie where a man uses tattoos to remember?',page_context:{page:'movie_detail'},conversation_state:{}}},res);
 assert.equal(response.kind,'answer','existing UI understands the response');assert.equal(response.intent,ASK_INTENTS.MOVIE_IDENTIFICATION);assert.match(response.answer,/One possibility is Memento/);assert.match(response.answer,/50 First Dates/);assert.equal(response.conversation_state.anchorMovie.id,77);
 assert.equal(classifyAskIntent({prompt:'Is it scary?',context:{page:'movie_detail'},conversation:response.conversation_state}),ASK_INTENTS.CURRENT_MOVIE_QUESTION);
 const previous = response.conversation_state;
 calls=[];
 await handlers['/reelbot/ask']({body:{prompt:'He used Polaroid photographs too.',page_context:{page:'movie_detail'},conversation_state:previous}},res);
 assert.equal(response.intent,ASK_INTENTS.MOVIE_IDENTIFICATION);
 assert.match(calls[0].userPrompt,/tattoos/);assert.match(calls[0].userPrompt,/Polaroid/);
 assert.equal(classifyAskIntent({prompt:'Find me something else like this',context:{page:'movie_detail'},conversation:previous}),ASK_INTENTS.MOVIE_RECOMMENDATION);
 // Exercise the homepage response contract, including safe abstention and bounded pools.
 for (const prompt of ["What's that movie where the guy relives the day over and over again", "What’s that movie where a man repeats a day", "What is that film where the day repeats?"]) {
   assert.equal(classifyAskIntent({prompt}),ASK_INTENTS.MOVIE_IDENTIFICATION,prompt);
 }
 calls=[];searches=[];
 let pick=await context.identificationPick({prompt:"What's that movie where the guy relives the day over and over again"});
 assert.equal(pick.primary.id,77);assert.match(pick.primary.reason,/One possibility is/);
 assert.equal(pick.rationale.primary_reason,pick.primary.reason);
 assert.equal(calls.length,2);assert.ok(searches.every(x=>x.path==='/search/movie'));
 pick=await context.identificationPick({prompt:'What was that movie?'},{bounded_pool:true,candidate_pool_ids:[1824]});
 assert.equal(pick.primary,null);assert.equal(pick.no_pick_reason,'identification_uncertain');assert.equal(pick.alternates.length,0);
 pick=await context.identificationPick({prompt:'What was that movie?'},{excluded_ids:[77]});
 assert.equal(pick.primary,null);assert.equal(pick.alternates.length,0,'frontend must not promote an alternative when primary is uncertain');
 ranking={primary_id:77,alternative_ids:[1824],confidence:'low',reason:'Not enough clues'};
 pick=await context.identificationPick({prompt:'What was that movie?'});
 assert.equal(pick.primary,null);assert.equal(pick.no_pick_reason,'identification_uncertain');assert.equal(pick.alternates.length,0);assert.match(pick.user_message,/another clue/);
 // Exact reported failure: unrelated primary AND alternatives cannot reach the ranker.
 const originalCandidates=candidates;
 const cluePrompt='Movie where a person or group of people are working late night at a food place and strange things happen';
 candidates=[{id:501,title:'Backrooms',overview:'A strange doorway opens in a furniture showroom.',poster_path:'/a.jpg'},{id:502,title:'Colony',overview:'Employees encounter strange events overnight in a biotech facility.',poster_path:'/b.jpg'},{id:503,title:'Facing El Chapo',overview:'Police work a final night shift confronting a cartel.',poster_path:'/c.jpg'},{id:504,title:'Last Straw',overview:'A waitress working the overnight shift at a rural diner faces a terrifying attack.',poster_path:'/d.jpg'}];
 queries=['Last Straw'];ranking={primary_id:504,alternative_ids:[501,502,503],confidence:'medium',reason:'A waitress faces danger during an overnight diner shift.'};calls=[];searches=[];
 pick=await context.identificationPick({prompt:cluePrompt});
 assert.equal(pick.primary.id,504);assert.equal(pick.alternates.length,0);
 const rankedInput=JSON.parse(calls[1].userPrompt);assert.deepEqual(rankedInput.candidates.map(m=>m.id),[504]);
 assert.ok(rankedInput.required_clues.includes('night work'));
 candidates=candidates.slice(0,3);calls=[];
 pick=await context.identificationPick({prompt:cluePrompt});assert.equal(pick.primary,null);assert.equal(pick.alternates.length,0);assert.equal(calls.length,1,'empty valid pool stops without a forced winner or extra call');
 candidates=originalCandidates;
 // Run the real /pick handler: identification errors bypass recommendation fallback.
 let fallbackCalls=0;
 Object.assign(context,{resolvePickPreferences:x=>x,needsVerifiedContentGuide:()=>false,
   shouldIncludePickDebug:()=>false,normalizeBehavioralMemory:()=>({seenMovieIds:new Set()}),normalizePickRefinement:()=>null,
   measureStage:async(label,fn)=>fn(),hydrateResolvedIntent:()=>{throw new Error('normal recommendation path');},
   finishTiming:()=>({}),buildPickFallbackPayload:async()=>{fallbackCalls++;return {primary:{id:999}};}});
 const generateStart=source.indexOf('const generatePickPayload =');
 const generateEnd=source.indexOf('\nconst ',generateStart+10);
 vm.runInContext(source.slice(generateStart,generateEnd),context);
 vm.runInContext(source.slice(source.indexOf('app.post("/reelbot/pick"'),source.indexOf('const movieIdentificationSchema')),context);
 ranking={primary_id:77,alternative_ids:[1824],confidence:'medium',reason:'Fits the clues'};
 await handlers['/reelbot/pick']({body:{prompt:"What's that movie where a man uses tattoos?"}},res);
 assert.equal(response.primary.id,77);assert.equal(response.intent,ASK_INTENTS.MOVIE_IDENTIFICATION);assert.equal(fallbackCalls,0);
 context.callStructuredOpenAI=async()=>{throw new Error('identification unavailable');};
 await handlers['/reelbot/pick']({body:{prompt:"What's that movie where a man uses tattoos?"}},res);
 assert.equal(response.primary,null);assert.equal(response.no_pick_reason,'identification_uncertain');assert.equal(fallbackCalls,0);
 await handlers['/reelbot/pick']({body:{prompt:'Something funny'}},res);
 assert.equal(fallbackCalls,1,'ordinary recommendations retain the existing path and fallback');
 console.log('Identification confidence, real-ID validation, alternatives, empty-clue fast path, call limits and existing-UI contract passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
