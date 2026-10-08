const fs=require('node:fs');
const API='https://movie-review-backend-zevb.onrender.com',COMMIT='fda730be3f7130f43ed6d649c589a266b81af3cd';
const prompts=[
'Movie where a person or group of people are working late night at a food place and strange things happen',
'Moive wher peopel are workign late nigth at a restaraunt and strnage things hapen',
'Something funny to watch after my shift at a restaurant',
'What was that movie where a man uses tattoos to remember things?',
'A smart sci-fi movie under 100 minutes, no horror',
'Something funny and easy to watch with friends',
'Movies about a woman who discovers messages from the future',
'A Sunday night feel good movie for adults',
'Something romantic but not cheesy','An all-time classic','A hidden gem with a clever twist',
'I loved Interstellar, something with that sense of wonder','Movies like Heat, but shorter','A comforting family adventure',
'A funny 90s action movie under two hours, no horror','A movie starring Denzel Washington, not just a cameo',
'A great movie directed by Christopher Nolan','A movie with a tragic ending, no spoilers please',
'Something gentle for a four year old, absolutely no scary scenes','A feature film under 10 minutes',
'A movie where a time-travelling octopus runs a restaurant on Jupiter','Movies like Alien, no horror',
'A sci-fi thriller, no horror or animation','A woman finds photographs that show tomorrow',
'A film about employees closing a diner while bizarre events happen','A tense movie from before 1970, no horror',
'A comedy released between 1985 and 1995, under 100 minutes'];
const supplied=[
['R01','Movie that takes place after a shift at a restaurant'],['R02','Movie where a person or group of people are working late night at a food place'],
['R06','A movie about restaurant employees finishing their shift'],['R05','Film in which a waitress works overnight in a diner'],
['P01','A movie where a crew is trapped on a spaceship'],['P02','A film set on a submarine'],['P04','A movie where a nurse works at night in a hospital'],
['P03','A movie where people are trapped on a train'],['P06','A movie where a man uses tattoos because he cannot make new memories'],
['P05','A movie set in a prison'],['P08','A movie where a guy relives the same day over and over'],
['E02','Movie where the hero dies in the end with Robert Downey Jr'],['E01','Movie where the hero dies in the end'],
['G08','A good movie for a date night, nothing too heavy'],['G10','A tense thriller no longer than 90 minutes'],
['C02','A Japanese drama from the 1960s'],['C04','A romantic comedy from the 1990s'],['C10','I want a thriller but no horror'],
['B02','A funny action movie under two hours'],['B01','Movie where people work late night at a food place'],['B03','Something moving but hopeful'],
['G05-exact','An all time must have classic'],['G07-exact','Movies like Heat, but a bit shorter'],['A07-fresh','A sweeping sci-fi epic over two hours']];
const raw=[],review=[];fs.mkdirSync('verification-output',{recursive:true});
function film(m){return m?{id:m.id,title:m.title,runtime:m.runtime,release_date:m.release_date,genres:m.genre_names,overview:m.overview,reason:m.reason,availability:m.availability_status}:null;}
function save(){fs.writeFileSync('verification-output/raw-results.json',JSON.stringify({backend_commit:COMMIT,frontend_commit:'5f4e2f4133f7034eb4ef9509ea09cb5d58b587b1',runner:'GitHub Actions',raw},null,2));fs.writeFileSync('verification-output/review-results.json',JSON.stringify(review));}
async function call(id,endpoint,body){const started_at=new Date().toISOString(),t=performance.now();let r={id,endpoint,request:body,started_at};try{const response=await fetch(API+endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-ReelBot-Trigger':'user_click'},body:JSON.stringify({trigger:'user_click',include_debug:true,...body,refresh_key:'verified-'+id+'-'+Date.now()+'-'+Math.random()}),signal:AbortSignal.timeout(90000)});r.http_status=response.status;const text=await response.text();try{r.data=JSON.parse(text);}catch{r.data={raw:text};}}catch(e){r.transport_error=e.message;}r.latency_ms=Math.round(performance.now()-t);raw.push(r);const d=r.data||{},p=d.recommendation||d;review.push({id,endpoint,prompt:body.prompt,original_prompt:body.original_prompt,started_at,http_status:r.http_status,transport_error:r.transport_error,latency_ms:r.latency_ms,cached:p.cached,kind:d.kind,intent:d.intent,primary:film(p.primary),alternates:(p.alternates||[]).map(film),answer:d.answer,message:p.user_message,no_match:p.no_pick_reason,hard:p.resolved_intent?.hard_filters,request_summary:{refinement:body.refinement,excluded_ids:body.excluded_ids},active_request:d.conversation_state?.activeRequest,active_task:d.conversation_state?.activeTask,constraints:d.conversation_state?.activeConstraints,evidence:p.debug_trace?.decision_evidence,fallback:p.debug_trace?.semantic_fallback,performance:p.performance});save();console.log('RESULT',id,r.http_status,p.primary?.title||d.intent||p.no_pick_reason||r.transport_error,r.latency_ms);return d;}
async function workers(jobs,n,run){let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<jobs.length)await run(jobs[i++]);}));}
const pick=(id,prompt,source='home',extra={})=>call(id,'/reelbot/pick',{prompt,source,view:'popular',mood:'all',genre:'all',runtime:'any',company:'any',...extra});
async function askSequence(round){const groups=[
['A smart sci-fi thriller, no horror, under 100 minutes','Another under 90 minutes','Actually, under 110 minutes instead','Is it scary?','Another pick please','Start fresh: a warm romantic comedy for adults'],
['A clever science-fiction thriller under 100 minutes without horror','One more, under 90 minutes','Make it under 110 minutes instead','Is this frightening?','Give me another please','New topic: an adult romantic comedy with warmth'],
['A thoughtful sci-fi thriller less than 100 minutes, exclude horror','Something else under 90 minutes','Change the limit to under 110 minutes','How scary is it?','One more please','Start fresh: a feel-good romantic comedy for grown-ups']];
let state={};for(const [i,prompt]of groups[round-1].entries()){const d=await call('ask-'+round+'-'+i,'/reelbot/ask',{prompt,page_context:{page:'general'},conversation_state:state});state=d.conversation_state||state;}}
async function pickSequence(name,prompt,actions){let last=await pick(name+'-initial',prompt),excluded=[];for(const[i,action]of actions.entries()){if(last.primary)excluded.push(last.primary.id);const refinement=action==='another'?undefined:{id:action,source_movie_id:last.primary?.id,source_movie_title:last.primary?.title,source_movie_runtime:last.primary?.runtime};const d=await call(name+'-'+i+'-'+action,'/reelbot/pick',{prompt:'unrelated edited draft',original_prompt:prompt,source:'home',is_swap:true,request_mode:'swap',intent_snapshot:last.resolved_intent,candidate_pool_ids:last.candidate_pool_ids,excluded_ids:excluded,last_pick_title:last.primary?.title,refinement});if(d.primary)last=d;else if(d.resolved_intent)last={...last,resolved_intent:d.resolved_intent};}}
async function sequences(){for(let i=1;i<=3;i++)await askSequence(i);let state={};for(const[i,prompt]of ['What was that movie where a man uses tattoos to remember things?','Is it scary?','He used Polaroid photographs too.'].entries()){const d=await call('memory-'+i,'/reelbot/ask',{prompt,page_context:{page:'general'},conversation_state:state});state=d.conversation_state||state;}await pickSequence('restaurant','Movie where people work late night at a food place and strange things happen',['another','another','another']);await pickSequence('scifi','A smart sci-fi movie under 100 minutes, no horror',['shorter','different_angle','another','shorter']);await pickSequence('adults','A Sunday night feel good movie for adults',['lighter','another']);await pickSequence('heat','Movies like Heat',['shorter','different_angle','another']);}
(async()=>{await Promise.all([workers(prompts.flatMap((prompt,index)=>[1,2,3].map(repeat=>({prompt,index,repeat}))),2,j=>pick('matrix-'+j.index+'-'+j.repeat,j.prompt,j.index%2?'library':'home')),sequences()]);
await workers(supplied,2,([id,prompt])=>pick('supplied-'+id,prompt,id.startsWith('B')?'library':'home'));
let prior=raw.find(r=>r.data?.primary?.title==='Last Straw'&&r.data.primary.runtime===81)?.data;
if(!prior){const search=await fetch(API+'/search?query=Last%20Straw');const results=await search.json();const movie=(results.results||[]).find(m=>m.title==='Last Straw'&&/^202[34]/.test(m.release_date));if(movie)prior=await pick('last-straw-fixture',prompts[0],'home',{candidate_pool_ids:[movie.id]});}
if(prior?.primary?.runtime===81){for(let i=1;i<=3;i++)await call('last-straw-shorter-'+i,'/reelbot/pick',{source:'home',prompt:'discarded draft',original_prompt:prior.resolved_preferences.prompt,intent_snapshot:prior.resolved_intent,candidate_pool_ids:prior.candidate_pool_ids,is_swap:true,request_mode:'swap',excluded_ids:[prior.primary.id],last_pick_title:prior.primary.title,refinement:{id:'shorter',source_movie_id:prior.primary.id,source_movie_title:prior.primary.title,source_movie_runtime:81}});}else console.log('FIXTURE_UNAVAILABLE Last Straw 81-minute primary');
for(let i=0;i<3;i++)await pick('passive-history-'+i,['A smart science-fiction movie under 100 minutes without horror','A clever sci-fi film less than 100 minutes, exclude horror','A thoughtful sci-fi movie, under 100 minutes and no horror'][i],'home',{behavioral_memory:{signalPolicyVersion:2,recentMovieIds:[262169,1137205,597],savedMovieIds:[262169],userProfile:{recentlyViewed:[{id:262169,title:'Gravy'}]},preferredGenres:{27:2}}});
for(let i=0;i<3;i++)await pick('company-friends-'+i,['A funny easy movie','Something amusing and relaxed','A light comedy for an easy evening'][i],'home',{company:'friends'});
await workers([prompts[4],prompts[5],prompts[6]].flatMap((prompt,index)=>[1,2,3].map(repeat=>({prompt,index,repeat}))),2,j=>pick('latency-'+j.index+'-'+j.repeat,j.prompt,j.index%2?'library':'home'));
const csv=['case,prompt,primary,alternatives,response_kind,http_status,latency_ms,no_match'];for(const r of review)csv.push([r.id,r.original_prompt||r.prompt,r.primary?.title||'',r.alternates.map(m=>m.title).join('; '),r.intent||r.kind||(r.primary?'recommendation':'no_match'),r.http_status||'',r.latency_ms,r.no_match||''].map(x=>'"'+String(x).replaceAll('"','""')+'"').join(','));fs.writeFileSync('verification-output/ungraded-results.csv',csv.join('\n'));
console.log('REELBOT_REVIEW_BASE64 '+Buffer.from(JSON.stringify({commit:COMMIT,review})).toString('base64'));console.log('REELBOT_COUNTS '+JSON.stringify({rows:review.length,transport:review.filter(r=>r.transport_error||r.http_status>=500).length,no_match:review.filter(r=>r.no_match).length}));
})().catch(e=>{console.error(e);save();process.exitCode=1;});
