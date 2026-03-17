const assert = require("assert");
const fixtures = require("../ai/evaluationFixtures");
const { parseReelbotIntent } = require("../ai/intentParser");

const failures = [];

fixtures.forEach((fixture) => {
  const parsed = parseReelbotIntent(fixture.prompt);
  const expected = fixture.expected || {};

  try {
    if (expected.prompt_type) {
      assert.strictEqual(parsed.prompt_type, expected.prompt_type);
    }
    if (expected.anchorPerson) {
      assert.strictEqual(parsed.anchors.person, expected.anchorPerson);
    }
    if (expected.anchorTitle) {
      assert.strictEqual(parsed.anchors.title, expected.anchorTitle);
    }
    if (expected.max_runtime_minutes) {
      assert.strictEqual(parsed.constraints.max_runtime_minutes, expected.max_runtime_minutes);
    }
    if (Array.isArray(expected.rubric_keys)) {
      expected.rubric_keys.forEach((key) => assert(parsed.rubric_keys.includes(key), `${fixture.prompt} missing rubric ${key}`));
    }
    if (Array.isArray(expected.avoid)) {
      expected.avoid.forEach((value) => assert(parsed.avoid.includes(value), `${fixture.prompt} missing avoid ${value}`));
    }
    if (expected.audiencePrimary) {
      assert.strictEqual(parsed.audience?.primary, expected.audiencePrimary);
    }
    if (expected.age_suitability) {
      assert.strictEqual(parsed.age_suitability, expected.age_suitability);
    }
    if (Array.isArray(expected.watch_context)) {
      expected.watch_context.forEach((value) => assert(parsed.watch_context?.includes(value), `${fixture.prompt} missing watch context ${value}`));
    }
    if (Array.isArray(expected.comfort_needs)) {
      expected.comfort_needs.forEach((value) => assert(parsed.comfort_needs?.includes(value), `${fixture.prompt} missing comfort need ${value}`));
    }
    if (Array.isArray(expected.avoidance_signals)) {
      expected.avoidance_signals.forEach((value) => assert(parsed.avoidance_signals?.includes(value), `${fixture.prompt} missing avoidance signal ${value}`));
    }
    if (Array.isArray(expected.preferred_genre_ids)) {
      expected.preferred_genre_ids.forEach((value) => assert(parsed.preferred_genre_ids?.includes(value), `${fixture.prompt} missing preferred genre ${value}`));
    }
    if (Array.isArray(expected.avoid_genre_ids)) {
      expected.avoid_genre_ids.forEach((value) => assert(parsed.avoid_genre_ids?.includes(value), `${fixture.prompt} missing avoid genre ${value}`));
    }
    if (typeof expected.guardrailActive === "boolean") {
      assert.strictEqual(Boolean(parsed.guardrails?.child_family_safe), expected.guardrailActive);
    }
    if (expected.friction_level) {
      assert.strictEqual(parsed.friction_level, expected.friction_level);
    }
  } catch (error) {
    failures.push({ prompt: fixture.prompt, error: error.message, parsed });
  }
});

if (failures.length) {
  console.error("ReelBot intent evaluation failed:");
  failures.forEach((failure) => {
    console.error(`- ${failure.prompt}: ${failure.error}`);
    console.error(`  Parsed: ${JSON.stringify(failure.parsed)}`);
  });
  process.exit(1);
}

console.log(`ReelBot intent evaluation passed for ${fixtures.length} prompts.`);
