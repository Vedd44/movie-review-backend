const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseReelbotIntent } = require('../ai/intentParser');
const { repairLegacyAudienceSnapshot } = require('../ai/intentSnapshotAudience');

// Run the real pure refinement function without starting a server or provider.
const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const start = source.indexOf('const appendUnique =');
const end = source.indexOf('const hydrateResolvedIntent =', start);
assert.ok(start > 0 && end > start);
const applyRefinement = vm.runInNewContext(`${source.slice(start, end)}; applyRefinementToIntent`);
const plain = value => JSON.parse(JSON.stringify(value));
const prompt = 'Halloween-y movie but not too scary, but not too childlike, under 100 minutes, no horror';
const fresh = parseReelbotIntent(prompt);
const legacy = {
  ...parseReelbotIntent(prompt.replace('childlike', 'child')),
  raw_prompt: prompt, normalized_prompt: prompt.toLowerCase(), lane_key: `${prompt}:refine:lighter:refine:shorter:refine:different_angle`,
  query_type: 'GENRE_OR_VIBE',
  refinement: { id: 'different_angle' },
  entity_anchor: { kind: 'movie_title', id: 99 },
  structured_query: { type: 'genre_theme', movie_ids: [91, 92] },
  plot_constraints: [{ relationship: 'original fixture relationship' }],
};
legacy.hard_filters = { ...legacy.hard_filters, max_runtime_minutes: 84, min_runtime_minutes: 45,
  min_release_year: 1980, max_release_year: 2020, required_genre_ids: [14], certification_allowlist: ['PG-13'],
  exclude_genre_ids: [27, 53, 80, 10752, 99] };
const before = plain(legacy);
const repaired = repairLegacyAudienceSnapshot(legacy, applyRefinement);
assert.deepEqual(plain(legacy), before, 'Never mutate the saved input');
assert.equal(repaired.guardrails.child_family_safe, false);
assert.equal(repaired.audience_age, null);
assert.ok(!repaired.rubric_keys.includes('family_comfort'));
assert.equal(repaired.strict_filters.child_safe_only, false);
assert.equal(repaired.hard_filters.family_safe_only, false);
assert.deepEqual(repaired.hard_filters.exclude_genre_ids, [99, 27], 'Keep explicit no-horror and unrelated exclusions');
for (const key of ['max_runtime_minutes', 'min_runtime_minutes', 'min_release_year', 'max_release_year', 'required_genre_ids', 'certification_allowlist']) {
  assert.deepEqual(repaired.hard_filters[key], legacy.hard_filters[key], key);
}
assert.equal(repaired.entity_anchor, legacy.entity_anchor);
assert.equal(repaired.structured_query, legacy.structured_query);
assert.equal(repaired.plot_constraints, legacy.plot_constraints);
assert.equal(repaired.soft_preferences.prefer_lane_diversity, true);
assert.ok(repaired.tone.includes('comforting'), 'Earlier lighter refinement survives a later refinement');
assert.ok(repaired.avoid_genre_ids.includes(53), 'Earlier lighter refinement still avoids thrillers softly');
assert.equal(repaired.runtime_commitment.preference, 'short');
assert.equal(repaired.lane_key, legacy.lane_key);
assert.equal(repairLegacyAudienceSnapshot(repaired, applyRefinement), repaired, 'Idempotent');
for (const ids of [['lighter', 'darker', 'shorter', 'shorter'], ['darker', 'lighter', 'different_angle']]) {
  const snapshot = { ...legacy, lane_key: `${prompt}${ids.map(id => `:refine:${id}`).join('')}`, refinement: { id: ids.at(-1), source_movie_runtime: 88 } };
  let expected = fresh;
  for (const id of ids) expected = applyRefinement(expected, { id });
  const migrated = repairLegacyAudienceSnapshot(snapshot, applyRefinement);
  assert.deepEqual(plain(migrated.tone), plain(expected.tone), 'Ordered refinements preserve final tone');
  assert.equal(migrated.emotional_tolerance.level, expected.emotional_tolerance.level);
  assert.equal(migrated.hard_filters.max_runtime_minutes, 84, 'Repeated shorter never loosens committed cap');
}
for (const untouched of [fresh, parseReelbotIntent('A spooky movie for my child, not too childish'), parseReelbotIntent('A movie for my toddler')]) {
  assert.equal(repairLegacyAudienceSnapshot(untouched, applyRefinement), untouched, 'Valid current and child snapshots remain untouched');
}
console.log('Legacy childlike snapshots repair audience state while retaining anchors, bounds and accumulated refinements.');
