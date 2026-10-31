const assert = require('node:assert/strict');
const { parseReelbotIntent } = require('../ai/intentParser');
const { getMildScareProfile } = require('../ai/mildScareProfile');
const { resolveExpandedRecommendationCandidates } = require('../ai/recommendationRetrieval');
assert.equal(parseReelbotIntent('A movie released between 1980 and 2000').audience_age, null, 'Between is not a tween audience');
assert.equal(parseReelbotIntent('A movie for tweens').audience_age, 'tweens');

for (const prompt of ['Nothing scary', 'Avoid spooky movies', 'Not a little scary', 'A scary movie, not mildly scary—genuinely terrifying', 'A scary movie, not just a little scary', 'A gentle drama, no frightening scenes', 'A Halloween movie', 'A terrifying horror film']) {
  assert.equal(getMildScareProfile(prompt).active, false, prompt);
}
const nonseasonal = getMildScareProfile('Something a little scary, but no Halloween theme');
assert.equal(nonseasonal.active, true);
assert.equal(nonseasonal.seasonal, false);
assert.equal(nonseasonal.keywordTerm, 'ghost');
async function retrieve(prompt, keywordMode = 'exact') {
  const calls = [];
  const candidates = new Map();
  const result = await resolveExpandedRecommendationCandidates({
    intent: parseReelbotIntent(prompt),
    fetchTmdb: async (endpoint, params) => {
      calls.push({ endpoint, params });
      if (endpoint === '/search/keyword') {
        if (keywordMode === 'error') throw new Error('Fixture taxonomy failure');
        return { results: keywordMode === 'exact' ? [{ id: 90, name: params.query }, { id: 91, name: `${params.query} parody` }] : [{ id: 91, name: `${params.query} parody` }] };
      }
      assert.equal(endpoint, '/discover/movie');
      const start = candidates.size + 1;
      const movies = Array.from({ length: 20 }, (_, index) => ({ id: start + index, title: `Fixture ${start + index}`, genre_ids: [14,35], vote_count: 300, popularity: 10, overview: 'Synthetic catalog fixture.' }));
      movies.forEach(movie => candidates.set(movie.id, movie));
      return { results: movies };
    },
    fetchStructuredMoviesByIds: async ids => ids.map(id => candidates.get(id)),
    normalizeStructuredCandidate: (movie, overrides = {}) => ({ ...movie, ...overrides }),
  });
  return { calls, result };
}
(async () => {
  for (const prompt of ['Halloween-y movie but not too scary, but not too childlike', 'Something just a little scary']) {
    for (const mode of ['exact', 'partial', 'error']) {
      const { calls, result } = await retrieve(prompt, mode);
      assert.equal(calls.length, 3, 'Keyword lookup replaces a catalog call rather than expanding budget');
      assert.equal(calls[0].endpoint, '/search/keyword');
      assert.equal(calls[0].params.query, prompt.startsWith('Halloween') ? 'halloween' : 'ghost');
      assert.equal(calls[1].params.with_keywords, mode === 'exact' ? 90 : undefined, 'No fuzzy taxonomy broadening');
      assert.equal(calls[2].params.with_genres, '27,35', 'Complementary conjunctive probe, not broad fantasy OR');
      assert.equal(result.length, mode === 'exact' ? 12 : 6, 'Six representatives per actual targeted probe survive low-popularity admission');
    }
  }
  const constrained = await retrieve('Halloween-y movie but not too scary, not too childlike, no horror, under 100 minutes, released between 1980 and 2000');
  assert.equal(constrained.calls[2].params.with_genres, '14,35');
  for (const { params } of constrained.calls.slice(1)) {
    assert.ok(params.without_genres.split(',').includes('27'));
    assert.equal(params['with_runtime.lte'], 99);
    assert.equal(params['primary_release_date.gte'], '1980-01-01');
    assert.equal(params['primary_release_date.lte'], '2000-12-31');
  }
  const explicit = await retrieve('A sci-fi movie, something just a little scary');
  assert.ok(explicit.calls.slice(1).every(call => call.params.with_genres === '878'), 'Explicit genre requirement is never overwritten by a probe');
  for (const prompt of ['Something romantic but not cheesy', 'Nothing scary', 'Avoid spooky movies']) {
    const { calls } = await retrieve(prompt);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => call.endpoint === '/discover/movie'), 'Unrelated/negative requests keep original three probes');
  }
  console.log('Mild-scare catalog probes retain the three-call budget, hard constraints and exact keyword identity.');
})().catch(error => { console.error(error); process.exitCode = 1; });
