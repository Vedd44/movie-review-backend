const assert = require('node:assert/strict');
const { parseReelbotIntent } = require('../ai/intentParser');
const { canUseKnownFilmMoodDiscovery } = require('../ai/mildScareProfile');
const originals = ['Halloween-y movie but not too scary, but not too childlike', 'Something just a little scary'];
for (const prompt of originals) {
  const intent = parseReelbotIntent(prompt);
  assert.equal(canUseKnownFilmMoodDiscovery(intent), true, prompt);
  const hydrated = { ...intent, query_type: 'GENRE_OR_VIBE', implicit_feature_runtime_floor: true, hard_filters: { ...intent.hard_filters, min_runtime_minutes: 40 } };
  assert.equal(canUseKnownFilmMoodDiscovery(hydrated), true, 'The explicitly marked feature floor is not a user factual request');
  assert.equal(canUseKnownFilmMoodDiscovery({ ...hydrated, implicit_feature_runtime_floor: false }), false);
  for (const clause of [
    'with no animal deaths', 'with no frightening scenes', 'with an actor named Keanu Reeves',
    'starring a woman', 'like Corpse Bride', 'that won an Oscar', 'from France', 'released this year',
    'available on Netflix tonight', 'currently in theaters', 'the latest release', 'under 100 minutes',
    'from the 1990s', 'PG only', 'where a ghost haunts a hospital', 'about a haunted house',
    'with practical effects', 'without CGI', 'based on a true story', 'for children', 'for tweens',
    'with verified content guidance', 'with a happy ending',
    'without adults',
  ]) assert.equal(canUseKnownFilmMoodDiscovery(parseReelbotIntent(`${prompt}, ${clause}`)), false, clause);
  for (const override of [
    { entity_anchor: { kind: 'actor', id: 123 } },
    { person_context: { id: 123, name: 'Fixture Actor' } },
    { anchors: { title: 'Example' } },
    { plot_constraints: [{ label: 'specific premise' }] },
    { audience_age: 'tweens' },
    { guardrails: { child_family_safe: true } },
    { refinement: { id: 'more_like_this' } },
    { hard_filters: { ...intent.hard_filters, max_runtime_minutes: 85 } },
    { hard_filters: { ...intent.hard_filters, min_release_year: 1990 } },
    { hard_filters: { family_safe_only: false } },
  ]) assert.equal(canUseKnownFilmMoodDiscovery({ ...intent, ...override }), false);
  assert.equal(canUseKnownFilmMoodDiscovery({ ...intent, raw_prompt: `${prompt}. Already tested: Corpse Bride` }), false, 'Do not pass expanded discovery text as the original request');
  assert.equal(canUseKnownFilmMoodDiscovery(intent), true, 'Caller eligibility remains a function of original resolved intent, not discovered title exclusions');
}
const excluded = parseReelbotIntent('Something just a little scary, no horror or animation');
const before = JSON.stringify(excluded);
assert.equal(canUseKnownFilmMoodDiscovery(excluded), true, 'Verified genre exclusions may remain on the known-film hypothesis path');
assert.equal(JSON.stringify(excluded), before, 'Policy never mutates constraints');
assert.ok(excluded.hard_filters.exclude_genre_ids.includes(27));
assert.ok(excluded.hard_filters.exclude_genre_ids.includes(16));
for (const malformed of [undefined, null, '', [], {}, { raw_prompt: originals[0] }]) assert.equal(canUseKnownFilmMoodDiscovery(malformed), false);
console.log('Known-film mood discovery is fail-closed to original general-audience mood requests; factual and current requirements retain web discovery.');
