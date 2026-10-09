const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Run the actual cache/transport functions without starting the app, loading
// credentials, or permitting network access. All transport completions and time
// advances are explicit so concurrent misses are deterministic.
const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const cacheCode = source.slice(source.indexOf('const tmdbCache ='), source.indexOf('const FEED_PAGE_ROTATION_LIMITS ='));
const fetchCode = source.slice(source.indexOf('const fetchTmdb ='), source.indexOf('const getFeedCacheTtl ='));
function harness() {
  let now = 1000;
  const calls = [];
  const context = {
    URLSearchParams,
    TMDB_API_KEY: 'offline-test',
    Date: { now: () => now },
    axios: {
      get(url, options) {
        return new Promise((resolve, reject) => {
          calls.push({ url, options, resolve: (data) => resolve({ data }), reject });
        });
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(`${cacheCode}\n${fetchCode}\nglobalThis.api = {
    fetchTmdbCached, tmdbCache, tmdbInFlight, CACHE_LIMITS, CACHE_TTLS, TMDB_IN_FLIGHT_MAX_AGE_MS,
  };`, context);
  return { ...context.api, calls, advance: (ms) => { now += ms; } };
}
const options = { timeout: 2000 };

test('20 identical cold misses share one transport and retain warm cache behavior', options, async () => {
  const h = harness();
  const params = { page: 1, append_to_response: 'credits' };
  const requests = Array.from({ length: 20 }, () => h.fetchTmdbCached('/movie/123', params));
  assert.equal(h.calls.length, 1);
  assert.equal(h.tmdbInFlight.size, 1);
  assert.equal(h.calls[0].options, undefined, 'Transport timeout/options are unchanged');
  assert.equal(new URL(h.calls[0].url).searchParams.get('append_to_response'), 'credits');
  const payload = { id: 123 };
  h.calls[0].resolve(payload);
  for (const value of await Promise.all(requests)) assert.equal(value, payload);
  assert.equal(h.tmdbInFlight.size, 0);
  assert.equal(await h.fetchTmdbCached('/movie/123', { append_to_response: 'credits', page: 1 }), payload);
  assert.equal(h.calls.length, 1, 'Stable parameter ordering still produces the same cache key');
});

test('Different paths and parameters proceed independently; slow keys do not block others', options, async () => {
  const h = harness();
  const slow = h.fetchTmdbCached('/movie/1', { append_to_response: 'credits' });
  const otherPath = h.fetchTmdbCached('/movie/2', { append_to_response: 'credits' });
  const full = h.fetchTmdbCached('/movie/1', { append_to_response: 'credits,reviews' });
  assert.equal(h.calls.length, 3);
  h.calls[1].resolve({ id: 2 });
  h.calls[2].resolve({ id: 1, reviews: [] });
  await Promise.all([otherPath, full]);
  assert.equal(h.tmdbInFlight.size, 1);
  h.calls[0].resolve({ id: 1 });
  await slow;
  assert.equal(h.tmdbInFlight.size, 0);
});

test('Rejection fans out unchanged, cleans tracking, and permits a later successful attempt', options, async () => {
  const h = harness();
  for (let round = 0; round < 10; round++) {
    const requests = Array.from({ length: 20 }, () => h.fetchTmdbCached('/movie/fail'));
    const settled = Promise.allSettled(requests);
    assert.equal(h.calls.length, round + 1, 'No automatic retry');
    const error = Object.assign(new Error('mock transport timeout'), { code: 'ECONNABORTED' });
    h.calls[round].reject(error);
    for (const result of await settled) {
      assert.equal(result.status, 'rejected');
      assert.equal(result.reason, error);
    }
    assert.equal(h.tmdbInFlight.size, 0);
    assert.equal(h.tmdbCache.size, 0);
  }
  const retry = h.fetchTmdbCached('/movie/fail');
  h.calls[10].resolve({ recovered: true });
  assert.equal((await retry).recovered, true);
  assert.equal(h.tmdbInFlight.size, 0);
});

test('TTL starts at settlement, expiry coalesces again, and first caller sets shared TTL', options, async () => {
  const h = harness();
  const first = h.fetchTmdbCached('/movie/1', {}, 50);
  const joined = h.fetchTmdbCached('/movie/1', {}, 500);
  h.advance(100);
  h.calls[0].resolve({ id: 1 });
  await Promise.all([first, joined]);
  assert.equal([...h.tmdbCache.values()][0].expiresAt, 1150);
  h.advance(49);
  await h.fetchTmdbCached('/movie/1');
  assert.equal(h.calls.length, 1);
  h.advance(1);
  const expired = Array.from({ length: 20 }, () => h.fetchTmdbCached('/movie/1'));
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve({ id: 1, refreshed: true });
  await Promise.all(expired);
  assert.equal([...h.tmdbCache.values()][0].expiresAt, 1150 + h.CACHE_TTLS.discover);
  assert.equal(h.tmdbInFlight.size, 0);
});

test('Tracking is bounded; overflow preserves independent transport without evicting pending keys', options, async () => {
  const h = harness();
  const limit = h.CACHE_LIMITS.tmdb;
  const pending = Array.from({ length: limit }, (_, i) => h.fetchTmdbCached(`/movie/${i}`));
  assert.equal(h.tmdbInFlight.size, limit);
  const joined = h.fetchTmdbCached('/movie/0');
  const overflow = [h.fetchTmdbCached('/movie/overflow'), h.fetchTmdbCached('/movie/overflow')];
  assert.equal(h.calls.length, limit + 2);
  assert.equal(h.tmdbInFlight.size, limit);
  h.calls[limit].resolve({ overflow: true });
  h.calls[limit + 1].resolve({ overflow: true });
  await Promise.all(overflow);
  assert.equal(h.tmdbInFlight.size, limit, 'Overflow settlement cannot delete tracked entries');
  for (let i = 0; i < limit; i++) h.calls[i].resolve({ id: i });
  await Promise.all([...pending, joined]);
  assert.equal(h.tmdbInFlight.size, 0);
  assert.equal(h.tmdbCache.size, limit, 'Existing completed-cache capacity is unchanged');
  assert.equal(h.tmdbCache.has('/movie/overflow:{}'), false, 'Original oldest-entry eviction is retained');
  const next = h.fetchTmdbCached('/movie/next');
  assert.equal(h.tmdbInFlight.size, 1, 'Capacity is reusable after settlement');
  h.calls.at(-1).resolve({ id: 'next' });
  await next;
  assert.equal(h.tmdbInFlight.size, 0);
  assert.equal(h.tmdbCache.size, limit);
  assert.equal(h.tmdbCache.has('/movie/0:{}'), false);
});

test('Hung transport is joinable only within the bounded window; old settlement preserves replacement', options, async () => {
  const h = harness();
  const original = h.fetchTmdbCached('/movie/stalled');
  h.advance(h.TMDB_IN_FLIGHT_MAX_AGE_MS - 1);
  const joined = h.fetchTmdbCached('/movie/stalled');
  assert.equal(h.calls.length, 1);
  h.advance(1);
  const replacement = h.fetchTmdbCached('/movie/stalled');
  assert.equal(h.calls.length, 2, 'An explicit later caller can proceed without the stalled original');
  assert.equal(h.tmdbInFlight.size, 1);
  const oldResults = Promise.allSettled([original, joined]);
  h.calls[0].reject(new Error('old transport eventually failed'));
  assert.ok((await oldResults).every(result => result.status === 'rejected'));
  assert.equal(h.tmdbInFlight.size, 1, 'Old settlement must not delete the newer entry');
  const joinedReplacement = h.fetchTmdbCached('/movie/stalled');
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve({ recovered: true });
  await Promise.all([replacement, joinedReplacement]);
  assert.equal(h.tmdbInFlight.size, 0);
});

test('New misses lazily reclaim aged tracking capacity without retrying or cancelling original work', options, async () => {
  const h = harness();
  const originals = Array.from({ length: h.CACHE_LIMITS.tmdb }, (_, i) => h.fetchTmdbCached(`/stalled/${i}`));
  h.advance(h.TMDB_IN_FLIGHT_MAX_AGE_MS);
  assert.equal(h.calls.length, h.CACHE_LIMITS.tmdb, 'Elapsed time alone does not trigger retries');
  const fresh = h.fetchTmdbCached('/fresh');
  assert.equal(h.tmdbInFlight.size, 1);
  assert.equal(h.calls.length, h.CACHE_LIMITS.tmdb + 1);
  h.calls.at(-1).resolve({ fresh: true });
  await fresh;
  assert.equal(h.tmdbInFlight.size, 0);
  for (let i = 0; i < originals.length; i++) h.calls[i].resolve({ id: i });
  await Promise.all(originals);
  assert.equal(h.tmdbInFlight.size, 0);
});
