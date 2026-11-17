const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Execute the complete, unchanged application and its local modules. Only the
// HTTP/framework/environment boundaries are substituted. No dotenv, sockets,
// credentials, provider clients, or unrestricted require enter this sandbox.
// Run: node --test scripts/testAskRouteJourney.js
// Coverage: registered handler + timing + state + real recommendation pipeline,
// enrichment, filtering, presentation and bounded provider fallback. This is
// not HTTP/middleware, frontend, unbounded discovery, or live-model quality QA.
// Synthetic film and model evidence tests objective orchestration guarantees;
// it makes no claim about subjective cinematic fit or generated prose quality.
function harness(movies, fixtures = {}) {
  const routes = new Map();
  const calls = [];
  const errors = [];
  const unexpected = [];
  const app = { use() {}, get() {}, post(route, ...handlers) { routes.set(route, handlers); },
    listen() { return { on() {} }; } };
  const express = Object.assign(() => app, { json: () => () => {} });
  const middleware = () => () => {};
  let failRanking = false;
  const transport = {
    async get(url) {
      calls.push({ method: 'GET', url });
      const parsed = new URL(url);
      assert.equal(parsed.hostname, 'api.themoviedb.org');
      const match = parsed.pathname.match(/^\/3\/movie\/(\d+)$/);
      if (match && movies[match[1]]) return { data: movies[match[1]] };
      const personMatch = parsed.pathname.match(/^\/3\/person\/(\d+)(\/movie_credits)?$/);
      if (personMatch && fixtures.person?.id === Number(personMatch[1])) return {data:personMatch[2] ? fixtures.credits : fixtures.person};
      if (parsed.pathname === '/3/search/movie' && fixtures.titleSearch) return {data:{results:fixtures.titleSearch(parsed.searchParams.get('query'))}};
      if (/^\/3\/search\/(movie|person|keyword|collection)$/.test(parsed.pathname)) return { data: { results: [] } };
      unexpected.push(url);
      throw new Error(`Unexpected offline GET: ${url}`);
    },
    async post(url, body) {
      calls.push({ method: 'POST', url, body });
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const schema = body.text.format.name;
      if (schema === 'reelbot_contextual_answer_v1') return response({ answer: 'The director is Fixture Director.', confidence: 'high', follow_ups: [] });
      assert.equal(schema, 'reelbot_pick_decision_v6');
      if (failRanking) throw new Error('Synthetic provider outage');
      const userText = body.input[1].content[0].text;
      const candidates = userText.split('\n').filter(line => line.startsWith('{') && line.includes('"id":')).map(line => JSON.parse(line));
      assert.ok(candidates.length, 'Ranker sees actual filtered candidates');
      const entry = movie => ({ id: movie.id, reason: 'Synthetic evidence supplied by the offline provider fixture.', experience_fit: 'strong', premise_fit: 'central', requirement_checks: [{ requirement: 'Current request', status: 'supported', evidence: 'Synthetic test fixture' }] });
      return response({ primary: entry(candidates[0]), backups: candidates.slice(1).map(entry) });
    },
  };
  function response(value) { return { data: { output_text: JSON.stringify(value) } }; }
  const context = vm.createContext({ URL, URLSearchParams, Buffer,
    console: { log() {}, warn() {}, error(...args) { errors.push(args); } },
    process: { env: { OPENAI_API_KEY: 'offline-fixture', TMDB_API_KEY: 'offline-fixture' }, on() {} },
    setTimeout() { throw new Error('Unexpected timer'); }, clearTimeout() {},
    setInterval() { throw new Error('Unexpected interval'); },
  });
  const modules = new Map();
  const root = path.resolve(__dirname, '..');
  function load(filename) {
    filename = require.resolve(filename);
    assert.ok(filename.startsWith(root + path.sep));
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    if (filename.endsWith(".json")) return module.exports = JSON.parse(fs.readFileSync(filename, "utf8"));
    const restrictedRequire = name => {
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name));
      if (['node:crypto', 'node:async_hooks', 'node:perf_hooks'].includes(name)) return require(name);
      if (name === 'fast-xml-parser') return require(name); // Pure parser used by isolated news worker; no transport.
      if (name === 'axios') return transport;
      if (name === 'dotenv') return { config() {} };
      if (name === 'express') return express;
      if (name === 'cors' || name === 'compression') return middleware;
      throw new Error(`Blocked module: ${name}`);
    };
    const fn = vm.runInContext(`(function(require,module,exports,__filename,__dirname){${fs.readFileSync(filename, 'utf8')}\n})`, context, { filename });
    fn(restrictedRequire, module, module.exports, filename, path.dirname(filename));
    return module.exports;
  }
  load(path.join(root, 'index.js'));
  return {
    calls, errors, unexpected, failRanking() { failRanking = true; },
    async ask(prompt, conversation_state = {}, ids = Object.keys(movies).map(Number)) {
      return this.askRaw({ prompt, trigger: 'user_click', conversation_state, page_context: { page: 'browse', visibleMovieIds: ids } });
    },
    async askRaw(body) {
      let payload; let status = 200;
      const req = { body, get: () => body.trigger };
      const res = { set() {}, status(value) { status = value; return this; }, json(value) { payload = value; return this; } };
      const handlers = routes.get('/reelbot/ask');
      assert.equal(handlers.length, 2, 'Harness must invoke every registered route handler');
      await handlers[0](req, res, () => handlers[1](req, res));
      return JSON.parse(JSON.stringify({ status, payload }));
    },
  };
}
function movie(id, runtime, genre_ids = [878, 53]) {
  return { id, title: `Fixture ${id}`, runtime, genre_ids, genres: genre_ids.map(id => ({ id, name: ({878:'Science Fiction',53:'Thriller',27:'Horror',35:'Comedy',10749:'Romance'})[id] })),
    overview: 'An adult scientist investigates a mysterious signal from an orbiting research station. A tense science fiction thriller about a dangerous scientific discovery.',
    release_date: '2010-01-01', vote_count: 1000, vote_average: 7.5, popularity: 25, adult: false, poster_path: '/fixture.jpg',
    credits: { cast: [], crew: [{job:'Director',name:'Fixture Director'}] }, keywords: { keywords: [] }, release_dates: {results:[{iso_3166_1:'US',release_dates:[{certification:'PG-13',type:4}]}]},
    'watch/providers': {results:{US:{flatrate:[{provider_id:8,provider_name:'Fixture'}]}}} };
}
test('actual Ask route preserves hard constraints across refinement, question, exhaustion and reset', async () => {
  const movies = { 1: movie(1, 95), 2: movie(2, 85), 3: movie(3, null), 4: movie(4, 80, [878,53,27]), 5: movie(5, 120), 6: movie(6, 110, [35,10749]), 8: movie(8, 97) };
  movies[6].overview = 'Two adults fall in love through comic misunderstandings in a warm romantic comedy.';
  const h = harness(movies);
  const first = await h.ask('An adult sci-fi thriller under 100 minutes, no horror');
  assert.equal(first.status, 200);
  assert.equal(first.payload.intent, 'GENERAL_RECOMMENDATION');
  assert.equal(first.payload.recommendation.primary.id, 1);
  assert.ok(!first.payload.conversation_state.recommendationHistory.some(entry => entry.id === 8));
  const shorter = await h.ask('shorter', first.payload.conversation_state);
  assert.equal(shorter.status, 200);
  assert.equal(shorter.payload.intent, 'REFINE_RECOMMENDATION');
  assert.equal(shorter.payload.recommendation.primary.id, 2);
  assert.equal(shorter.payload.conversation_state.activeConstraints.maxRuntime, 94);
  assert.ok(!shorter.payload.recommendation.candidate_pool_ids.includes(8), 'Unseen 97-minute candidate must fail the tightened cap, independently of history exclusions');
  for (const [turn, cap] of [[first, 99], [shorter, 94]]) {
    const rec = turn.payload.recommendation;
    assert.equal(rec.resolved_intent.hard_filters.max_runtime_minutes, cap);
    assert.ok(rec.resolved_intent.hard_filters.exclude_genre_ids.includes(27));
    assert.ok(rec.resolved_intent.hard_filters.required_genre_ids.includes(878));
    for (const candidate of [rec.primary, ...rec.alternates]) {
      assert.ok(candidate.runtime > 0 && candidate.runtime <= cap);
      assert.ok(candidate.genre_names.includes('Science Fiction'));
      assert.ok(!candidate.genre_names.includes('Horror'));
      assert.ok(![3,4,5,6].includes(candidate.id));
    }
  }
  const question = await h.ask('Who directed it?', shorter.payload.conversation_state);
  assert.equal(question.status, 200);
  assert.equal(question.payload.intent, 'CURRENT_MOVIE_QUESTION');
  assert.equal(question.payload.movie_id, 2);
  assert.match(question.payload.answer, /Fixture Director/);
  const answerCall = h.calls.find(call => call.body?.text?.format?.name === 'reelbot_contextual_answer_v1');
  const answerPrompt = answerCall.body.input[1].content[0].text;
  const currentMovie = JSON.parse(answerPrompt.match(/Current movie: ([^\n]+)/)[1]);
  assert.equal(currentMovie.id, 2, 'Answer provider receives the refined pick, not the original anchor');
  assert.equal(currentMovie.title, 'Fixture 2');
  assert.equal(currentMovie.director, 'Fixture Director');
  assert.equal(currentMovie.runtime, 85);
  const previousTurn = JSON.parse(answerPrompt.match(/Previous panel turn: ([^\n]+)/)[1]);
  assert.equal(previousTurn.active_constraints.maxRuntime, 94);
  assert.deepEqual(question.payload.conversation_state.activeConstraints, shorter.payload.conversation_state.activeConstraints);
  assert.deepEqual(question.payload.conversation_state.recommendationHistory, shorter.payload.conversation_state.recommendationHistory);
  const next = await h.ask('Another', question.payload.conversation_state);
  assert.equal(next.status, 200);
  assert.equal(next.payload.intent, 'NEXT_RECOMMENDATION');
  assert.equal(next.payload.recommendation.primary, null);
  assert.deepEqual(next.payload.recommendation.alternates, []);
  assert.equal(next.payload.recommendation.no_pick_reason, 'no_suitable_candidate');
  assert.match(next.payload.recommendation.user_message, /94 minutes.*keeping the other details/);
  assert.equal(next.payload.recommendation.resolved_intent.hard_filters.max_runtime_minutes, 94);
  assert.deepEqual(next.payload.conversation_state.recommendationHistory.map(x => x.id), [1,2]);
  const fresh = await h.ask('New topic: a romantic comedy', next.payload.conversation_state);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.payload.intent, 'GENERAL_RECOMMENDATION');
  assert.equal(fresh.payload.recommendation.primary.id, 6);
  assert.equal(fresh.payload.recommendation.primary.runtime, 110, 'Old runtime constraint is cleared');
  assert.equal(fresh.payload.conversation_state.activeConstraints.maxRuntime, undefined);
  assert.deepEqual(fresh.payload.conversation_state.recommendationHistory.map(x => x.id), [6]);
  assert.deepEqual(fresh.payload.conversation_state.userCorrections, []);
  assert.deepEqual(h.unexpected, []);
  assert.deepEqual(h.errors, []);
});

test('actual Ask route rejects contradictory plot metadata without inventing a fallback', async () => {
  const wrong = movie(7, 90);
  wrong.overview = 'A crew is trapped in a submarine deep beneath the ocean.';
  const h = harness({7: wrong});
  const result = await h.ask('An adult sci-fi thriller under 100 minutes, no horror, where a crew is trapped on a spaceship');
  assert.equal(result.status, 200);
  assert.equal(result.payload.recommendation.primary, null);
  assert.deepEqual(result.payload.recommendation.alternates, []);
  assert.equal(result.payload.recommendation.no_pick_reason, 'no_suitable_candidate');
  assert.equal(h.calls.filter(x => x.method === 'POST').length, 0, 'Contradictory metadata is rejected before ranking');
  assert.deepEqual(h.unexpected, []);
  assert.deepEqual(h.errors, []);
});

test('actual Ask route tries bounded model fallback then returns retryable 503 on provider failure', async () => {
  const h = harness({1: movie(1, 95)});
  h.failRanking();
  const result = await h.ask('An adult sci-fi thriller under 100 minutes, no horror');
  assert.equal(result.status, 503);
  assert.equal(result.payload.error_code, 'recommendation_unavailable');
  assert.equal(result.payload.retryable, true);
  assert.equal(result.payload.recommendation, undefined, 'No metadata-only fabricated recommendation');
  const calls = h.calls.filter(x => x.method === 'POST');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.model, 'gpt-5-mini');
  assert.notEqual(calls[0].body.model, calls[1].body.model);
  assert.deepEqual(h.unexpected, []);
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0][1], /Synthetic provider outage/);
});

test('seen feedback replaces the film, but compound questions answer without changing the search', async () => {
  const h = harness({1: movie(1,95),2:movie(2,85),3:movie(3,80,[878,53,27]),4:movie(4,120)});
  const first=await h.ask('An adult sci-fi thriller under 100 minutes, no horror');
  assert.equal(first.status,200);
  for(const prompt of ["I've seen it. Who directed it?",'I watched this, can you explain the ending?']) {
    const answer=await h.ask(prompt,first.payload.conversation_state);
    assert.equal(answer.status,200);
    assert.equal(answer.payload.intent,'CURRENT_MOVIE_QUESTION');
    assert.equal(answer.payload.kind,'answer');
    assert.equal(answer.payload.movie_id,first.payload.recommendation.primary.id);
    assert.deepEqual(answer.payload.conversation_state.recommendationHistory,first.payload.conversation_state.recommendationHistory);
    assert.equal(answer.payload.conversation_state.activeRequest,first.payload.conversation_state.activeRequest);
  }
  const next=await h.ask('I already watched this',first.payload.conversation_state);
  assert.equal(next.status,200);
  assert.equal(next.payload.intent,'REFINE_RECOMMENDATION');
  assert.notEqual(next.payload.recommendation.primary.id,first.payload.recommendation.primary.id);
  assert.ok(next.payload.recommendation.primary.runtime<100);
  assert.ok(!next.payload.recommendation.primary.genre_names.includes('Horror'));
  assert.deepEqual(h.unexpected,[]);
});


test('raw My Movies context keeps seen feedback in saved films and preserves explicit watched-library requests', async () => {
  const movies = {1:movie(1,95),2:movie(2,85),3:movie(3,80,[878,53,27]),4:movie(4,120)};
  const activeRequest = 'An adult sci-fi thriller under 100 minutes, no horror';
  const conversation_state = {activeRequest,activeIntent:'GENERAL_RECOMMENDATION',anchorMovie:{id:1,title:'Fixture 1'},recommendationHistory:[{id:1,title:'Fixture 1',status:'recommended'}]};
  const page_context = {page:'my_movies',savedMovieIds:[2,3,4],watchedMovieIds:[1]};
  for (const prompt of ["I've seen it",'I already watched this',"I've seen it. Could you give me another movie?"]) {
    const h=harness(movies);
    const result=await h.askRaw({prompt,trigger:'user_click',conversation_state,page_context});
    assert.equal(result.status,200);
    assert.equal(result.payload.intent,'REFINE_RECOMMENDATION');
    assert.equal(result.payload.recommendation.primary.id,2);
    assert.equal(result.payload.conversation_state.activeRequest,activeRequest);
    assert.equal(result.payload.conversation_state.recommendationHistory[0].status,'rejected');
    assert.deepEqual(h.unexpected,[]);
    assert.deepEqual(h.errors,[]);
  }
  for (const prompt of ['Recommend a movie I have seen','Recommend something I have watched before','Recommend a movie to rewatch']) {
    const h=harness(movies);
    const result=await h.askRaw({prompt,trigger:'user_click',page_context});
    assert.equal(result.status,200);
    assert.equal(result.payload.recommendation.primary.id,1, prompt);
    assert.deepEqual(h.unexpected,[]);
    assert.deepEqual(h.errors,[]);
  }
});


for (const department of ['Acting','Directing']) {
  test(`raw ${department} filmography preserves constraints and rejects only the seen anchor`, async () => {
    const movies={1:movie(1,95),2:movie(2,85),3:movie(3,80,[878,53,27]),4:movie(4,120),5:movie(5,90)};
    const credits=Object.values(movies).filter(m=>m.id!==5).map(m=>({...m,order:1,character:'Scientist',job:'Director',department:'Directing'}));
    const h=harness(movies,{person:{id:101,name:'Fixture Person',known_for_department:department},credits:department==='Acting'?{cast:credits,crew:[]}:{cast:[],crew:credits}});
    const activeRequest='An adult sci-fi thriller under 100 minutes, no horror';
    const page_context={page:'person',personId:101,visibleMovieIds:[1,2,3,4,5]};
    const conversation_state={activeRequest,activeIntent:'CURRENT_SET_RECOMMENDATION',anchorMovie:{id:1,title:'Fixture 1'},recommendationHistory:[{id:1,title:'Fixture 1',status:'recommended'}]};
    const result=await h.askRaw({prompt:'I already watched this',trigger:'user_click',page_context,conversation_state});
    assert.equal(result.status,200);
    assert.equal(result.payload.intent,'REFINE_RECOMMENDATION');
    assert.equal(result.payload.recommendation.primary.id,2);
    assert.equal(result.payload.conversation_state.activeRequest,activeRequest);
    assert.equal(result.payload.conversation_state.recommendationHistory[0].status,'rejected');
    assert.ok(!result.payload.recommendation.candidate_pool_ids.includes(5),'Visible non-credit film must not enter person pool');
    const answer=await h.askRaw({prompt:"I've seen it. Who directed it?",trigger:'user_click',page_context,conversation_state:result.payload.conversation_state});
    assert.equal(answer.payload.intent,'CURRENT_MOVIE_QUESTION');
    assert.equal(answer.payload.movie_id,2);
    assert.deepEqual(answer.payload.conversation_state.recommendationHistory,result.payload.conversation_state.recommendationHistory);
    assert.equal(answer.payload.conversation_state.activeRequest,activeRequest);
    assert.deepEqual(h.unexpected,[]);assert.deepEqual(h.errors,[]);
  });
}

test('raw named-title It question resolves title metadata rather than pronoun seen feedback', async () => {
  const it={...movie(10,95),title:'It'};
  const h=harness({10:it},{titleSearch:query=>query.toLowerCase()==='it'?[it]:[]});
  const result=await h.askRaw({prompt:'Is It scary?',trigger:'user_click',page_context:{page:'movie_detail'}});
  assert.equal(result.status,200);assert.equal(result.payload.intent,'CURRENT_MOVIE_QUESTION');
  assert.equal(result.payload.movie_id,10);
  assert.deepEqual(result.payload.conversation_state.recommendationHistory,[]);
  const call=h.calls.find(c=>c.body?.text?.format?.name==='reelbot_contextual_answer_v1');
  assert.match(call.body.input[1].content[0].text, /"title":"It"/);
  assert.deepEqual(h.unexpected,[]);assert.deepEqual(h.errors,[]);
});

test('explicit change of plan discards old constraints after a film question', async () => {
  const h = harness({1:movie(1,95,[35]),2:movie(2,135,[53])});
  const prior = { activeIntent:'CURRENT_MOVIE_QUESTION',activeTask:'GENERAL_RECOMMENDATION',activeRequest:'A funny movie under 100 minutes, no horror',anchorMovie:{id:1,title:'Fixture 1',runtime:95}, activeConstraints:{maxRuntime:99,preferences:['funny'],hardExclusions:['runtime_cap','no_horror']},recommendationHistory:[{id:1,status:'recommended'}],userCorrections:['shorter'] };
  const prompt='Actually change of plan: a serious thriller, no comedy.';
  const result=await h.ask(prompt,prior);
  assert.equal(result.status,200);
  assert.equal(result.payload.intent,'GENERAL_RECOMMENDATION');
  assert.equal(result.payload.conversation_state.activeRequest,prompt);
  assert.ok(!result.payload.conversation_state.activeConstraints.maxRuntime);
  assert.ok(!result.payload.conversation_state.activeConstraints.preferences.includes('funny'));
  assert.ok(!result.payload.conversation_state.activeConstraints.hardExclusions.includes('no_horror'));
  assert.deepEqual(result.payload.conversation_state.userCorrections,[]);
  assert.equal(result.payload.recommendation.primary.id,2);
  assert.equal(result.payload.recommendation.primary.runtime,135);
  assert.deepEqual(h.unexpected,[]);assert.deepEqual(h.errors,[]);
});
