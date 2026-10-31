const assert = require('node:assert/strict');
const { parseReelbotIntent } = require('../ai/intentParser');
const { buildRecommendationRetrievalPlan } = require('../ai/recommendationRetrieval');

// The exact reported request is a tone constraint, not a child audience.
for (const prompt of [
  'Halloween-y movie but not too scary, but not too childlike',
  'A spooky movie, not childish',
  'Something just a little scary',
  'A Halloween movie that is not too scary',
]) {
  const intent = parseReelbotIntent(prompt);
  const plan = buildRecommendationRetrievalPlan(intent);
  assert.equal(intent.guardrails.child_family_safe, false, prompt);
  assert.equal(intent.audience_age, null, prompt);
  assert.equal(intent.hard_filters.family_safe_only, false, prompt);
  assert.ok(!intent.rubric_keys.includes('family_comfort'), prompt);
  assert.ok(!intent.hard_filters.exclude_genre_ids.includes(27), prompt);
  assert.ok(!intent.hard_filters.exclude_genre_ids.includes(53), prompt);
  assert.ok(!intent.preferred_genre_ids.includes(16), prompt);
  assert.ok(!intent.preferred_genre_ids.includes(10751), prompt);
  assert.equal(plan.family_safe_bias, false, prompt);
  assert.ok(!plan.discover_genre_ids.includes(16), prompt);
  assert.ok(!plan.discover_genre_ids.includes(10751), prompt);
  assert.equal(intent.raw_prompt, prompt, 'The complete tone/occasion request still reaches ranking');
}
assert.equal(parseReelbotIntent('A Halloween movie that is not too scary').content_safety, 'safe', 'Keep the requested lower intensity signal');

for (const prompt of [
  'A spooky movie for my child',
  'A movie for my children',
  'A gentle movie for young kids',
  'A movie for my 5-year-old',
  'A family-friendly Halloween movie, not too scary',
]) {
  const intent = parseReelbotIntent(prompt);
  assert.equal(intent.guardrails.child_family_safe, true, prompt);
  assert.equal(intent.hard_filters.family_safe_only, true, prompt);
  assert.ok(intent.hard_filters.exclude_genre_ids.includes(27), prompt);
  assert.equal(buildRecommendationRetrievalPlan(intent).family_safe_bias, true, prompt);
}
const constrained = parseReelbotIntent('Halloween-y movie but not too scary, but not too childlike, under 100 minutes, no horror');
assert.ok(constrained.hard_filters.exclude_genre_ids.includes(27), 'Explicit no-horror remains binding');
assert.equal(constrained.hard_filters.max_runtime_minutes, 99, 'Runtime remains binding');
console.log('Mild-scare requests retain tone and explicit constraints without inventing a child audience.');

// Positive low-scare wording should reach relevant catalog genres without
// turning a soft experience preference into a mandatory horror genre.
for (const prompt of ['Something just a little scary', 'Halloween-y movie but not too scary, but not too childlike', 'A spooky mystery']) {
  const intent = parseReelbotIntent(prompt);
  const plan = buildRecommendationRetrievalPlan(intent);
  assert.ok(plan.discover_genre_ids.includes(27), prompt);
  assert.ok(plan.discover_genre_ids.includes(9648), prompt);
  assert.ok(!intent.hard_filters.required_genre_ids.includes(27), 'Spooky is not a hard horror requirement');
}
for (const prompt of ['Nothing scary', 'A comedy, not scary', 'Something without anything scary', 'A movie that is not too scary', 'No Halloween or spooky movies', 'A not-scary movie', 'A non-scary movie', 'A movie with no horror or scary scenes', 'Nothing scary, spooky or frightening', 'No horror, spooky or scary stuff', "I don't want anything scary", 'I don’t want anything scary', 'Avoiding scary movies tonight', 'I hate scary movies', 'Anything except spooky movies', 'Exclude scary movies']) {
  assert.ok(!parseReelbotIntent(prompt).preferred_genre_ids.includes(27), 'Negated scares do not request horror');
}
const noHorror = parseReelbotIntent('A little scary, but no horror, under 100 minutes');
assert.ok(noHorror.hard_filters.exclude_genre_ids.includes(27));
assert.equal(noHorror.hard_filters.max_runtime_minutes, 99);
