const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Execute the complete, unchanged application and its local modules. Only the
// HTTP/framework/environment boundaries are substituted. No dotenv, sockets,
// credentials, provider clients, or unrestricted require enter this sandbox.
// Run: node --test scripts/testMildScarePickJourney.js
// Coverage: registered pick handler + timing + real recommendation pipeline,
// retrieval, enrichment, filtering, exclusion continuity and abstention. This is
// not HTTP middleware, frontend, or live-model quality/latency QA.
// Synthetic film and model evidence tests objective orchestration guarantees;
// it makes no claim about subjective cinematic fit or generated prose quality.
function harness(movies, { returnNoMatch = false, initialRankAbstains = false, discoveryFilms = [], hiddenIds = [] } = {}) {
  const routes = new Map();
  const calls = [];
  const errors = [];
  const unexpected = [];
  const app = { use() {}, get() {}, post(route, ...handlers) { routes.set(route, handlers); },
    listen() { return { on() {} }; } };
  const express = Object.assign(() => app, { json: () => () => {} });
  const middleware = () => () => {};
  let failRanking = false;
  let decisionCalls = 0;
  const transport = {
    async get(url) {
      calls.push({ method: 'GET', url });
      const parsed = new URL(url);
      assert.equal(parsed.hostname, 'api.themoviedb.org');
      const match = parsed.pathname.match(/^\/3\/movie\/(\d+)$/);
      if (match && movies[match[1]]) return { data: movies[match[1]] };
      if (parsed.pathname === '/3/search/movie') return { data: { results: Object.values(movies).filter(movie=>movie.title===parsed.searchParams.get('query')) } };
      if (/^\/3\/search\/(person|keyword|collection)$/.test(parsed.pathname)) return { data: { results: [] } };
      if (parsed.pathname === '/3/discover/movie' || /^\/3\/movie\/(popular|now_playing|upcoming|top_rated)$/.test(parsed.pathname) || parsed.pathname === '/3/trending/movie/week') return { data: { results: Object.values(movies).filter(movie=>!hiddenIds.includes(movie.id)), page: 1, total_pages: 1 } };
      unexpected.push(url);
      throw new Error(`Unexpected offline GET: ${url}`);
    },
    async post(url, body) {
      calls.push({ method: 'POST', url, body });
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const schema = body.text.format.name;
      if (schema === 'reelbot_contextual_answer_v1') return response({ answer: 'The director is Fixture Director.', confidence: 'high', follow_ups: [] });
      if (schema === 'movie_identification_queries') return response({films:discoveryFilms,keyword_terms:[]});
      assert.equal(schema, 'reelbot_pick_decision_v6');
      decisionCalls += 1;
      if (returnNoMatch || (initialRankAbstains && decisionCalls===1)) return response({primary:null,backups:[]});
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
  const root = process.env.REELBOT_TEST_ROOT || path.resolve(__dirname, '..');
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
    async pick(prompt, previous = null, extra = {}) {
      let payload; let status = 200;
      const req = { body: {prompt, source:'library', view:'popular', runtime:'any', mood:'all', company:'any', trigger:'user_click', ...(previous ? {is_swap:true, original_prompt:prompt, intent_snapshot:previous.resolved_intent, excluded_ids:[previous.primary.id], last_pick_title:previous.primary.title} : {}), ...extra}, get: () => 'user_click' };
      const res = { set() {}, status(value) { status = value; return this; }, json(value) { payload = value; return this; } };
      const handlers = routes.get('/reelbot/pick');
      assert.equal(handlers.length, 2);
      await handlers[0](req, res, () => handlers[1](req, res));
      return JSON.parse(JSON.stringify({ status, payload }));

    },
  };
}
function movie(id, genre_ids = [14,35]) {
  return { id, title: `Spooky Fixture ${id}`, runtime:90, genre_ids,
    genres:genre_ids.map(id=>({id,name:({14:'Fantasy',35:'Comedy',9648:'Mystery',27:'Horror'})[id]})),
    overview:'A grown-up supernatural comedy about a haunted house, friendly ghosts, and an eerie mystery. Witty macabre humor brings a spooky atmosphere without intense scares.',
    release_date:'1990-01-01', vote_count:5000, vote_average:7.5, popularity:50, adult:false,poster_path:'/fixture.jpg',
    keywords:{keywords:[]}, release_dates:{results:[{iso_3166_1:'US',release_dates:[{certification:'PG-13',type:4}]}]},
    'watch/providers':{results:{US:{flatrate:[{provider_id:8,provider_name:'Fixture'}]}}}};
}

// These are orchestration tests with synthetic movie/model fixtures, not claims
// that a real model has judged these fictional films or that live latency passed.
test('reported Halloween request keeps general audience through repeated picks without duplicates', async()=>{
  const prompt='Halloween-y movie but not too scary, but not too childlike';
  const h=harness({1:movie(1),2:movie(2),3:movie(3)});
  const first=await h.pick(prompt);
  assert.equal(first.status,200); assert.ok(first.payload.primary, 'A valid adult/general candidate survives');
  assert.equal(first.payload.resolved_intent.guardrails.child_family_safe,false);
  const excluded=[first.payload.primary.id];
  const second=await h.pick(prompt,first.payload,{excluded_ids:excluded});
  assert.ok(second.payload.primary); assert.ok(!excluded.includes(second.payload.primary.id));
  excluded.push(second.payload.primary.id);
  const third=await h.pick(prompt,second.payload,{excluded_ids:excluded});
  assert.ok(third.payload.primary); assert.ok(!excluded.includes(third.payload.primary.id));
  assert.equal(third.payload.resolved_intent.raw_prompt,prompt);
  assert.equal(h.calls.filter(c=>c.method==='POST').length,3,'One decision call per successful request; no discovery/model expansion');
  assert.equal(h.unexpected.length,0);
});

test('low-scare request retrieves relevant soft genres and keeps no-horror/runtime constraints', async()=>{
  const h=harness({1:movie(1),2:movie(2,[27]),3:{...movie(3),runtime:130}});
  const result=await h.pick('Something just a little scary, under 100 minutes, no horror');
  assert.equal(result.status,200); assert.equal(result.payload.primary.id,1);
  assert.equal(result.payload.resolved_intent.hard_filters.max_runtime_minutes,99);
  assert.ok(result.payload.resolved_intent.hard_filters.exclude_genre_ids.includes(27));
  assert.deepEqual(result.payload.candidate_pool_ids,[1]);
  const discovered=h.calls.filter(c=>c.method==='GET'&&c.url.includes('/discover/movie'));
  assert.ok(discovered.some(c=>new URL(c.url).searchParams.get('with_genres')?.includes('9648')));
});

test('a semantic rejection is not replaced by a loosely related local-scoring winner', async()=>{
  const h=harness({1:movie(1)},{returnNoMatch:true});
  const result=await h.pick('Halloween-y movie but not too scary, but not too childlike');
  assert.equal(result.status,200); assert.equal(result.payload.primary,null);
  assert.equal(result.payload.no_pick_reason,'no_suitable_candidate');
  assert.equal(h.calls.filter(c=>c.method==='POST'&&c.body.text.format.name==='movie_identification_queries').length,1,'Existing single semantic retry budget remains');
  const discovery = h.calls.find(c=>c.method==='POST'&&c.body.text.format.name==='movie_identification_queries');
  assert.equal(discovery.body.tools,undefined,'Pure mild-spooky mood fallback does not force a web tool');
  assert.equal(discovery.body.tool_choice,undefined);
  assert.ok(Number.isFinite(result.payload.performance.stages.semantic_discovery),'The formerly hidden fallback phase has its own timing');
});

test('factual plot discovery retains web verification even when the request is mildly scary', async()=>{
  const h=harness({1:movie(1)},{returnNoMatch:true});
  await h.pick('Something just a little scary where the hero dies at the end');
  const discoveries=h.calls.filter(c=>c.method==='POST'&&c.body.text.format.name==='movie_identification_queries');
  assert.ok(discoveries.length>0);
  assert.ok(discoveries.every(c=>c.body.tool_choice?.type==='web_search'),'Mood words cannot disable factual plot verification');
});

test('known-film mood fallback validates real title identity and never invents retrieved evidence', async()=>{
  const prompt='Halloween-y movie but not too scary, but not too childlike';
  const h=harness({1:movie(1),4:movie(4)},{initialRankAbstains:true,hiddenIds:[4],discoveryFilms:[
    {title:'Nonexistent fabricated hypothesis',release_year:1990,facts:'Fabricated evidence',source_urls:['https://example.invalid/fake']},
    {title:'Spooky Fixture 4',release_year:1990,facts:'Fabricated evidence',source_urls:['https://example.invalid/fake']},
  ]});
  const result=await h.pick(prompt,null,{include_debug:true});
  assert.equal(result.status,200);
  assert.equal(result.payload.primary.id,4,'Only the real catalogue identity can survive the fallback');
  assert.equal(result.payload.resolved_intent.raw_prompt,prompt);
  assert.deepEqual(result.payload.debug_trace.discovery_evidence,[],'Model-written sources are not retrieved evidence');
  const posts=h.calls.filter(call=>call.method==='POST');
  assert.equal(posts.length,3,'One initial decision, one title-hypothesis call, one final decision; no extra retries');
  assert.equal(posts[1].body.tools,undefined);
  assert.ok(posts[2].body.input[1].content[0].text.includes(prompt),'Final decision retains complete original brief');
});

test('non-text current or factual viewing controls retain existing web discovery', async()=>{
  for (const extra of [{view:'now_playing'},{runtime:'under_two_hours'},{include_theatrical:true},{company:'pair'}]) {
    const h=harness({1:movie(1)},{returnNoMatch:true});
    await h.pick('Something just a little scary',null,extra);
    const discoveries=h.calls.filter(c=>c.method==='POST'&&c.body.text.format.name==='movie_identification_queries');
    assert.ok(discoveries.length>0,JSON.stringify(extra));
    assert.ok(discoveries.every(c=>c.body.tool_choice?.type==='web_search'),JSON.stringify(extra));
  }
});
