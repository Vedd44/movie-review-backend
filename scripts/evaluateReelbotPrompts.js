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
    if (expected.strictAudience) {
      assert.strictEqual(parsed.strict_filters?.audience, expected.strictAudience);
    }
    if (Array.isArray(expected.strictRatings)) {
      expected.strictRatings.forEach((value) =>
        assert(parsed.strict_filters?.rating_allowlist?.includes(value), `${fixture.prompt} missing strict rating ${value}`));
    }
    if (Array.isArray(expected.strictThemeTerms)) {
      expected.strictThemeTerms.forEach((value) =>
        assert(parsed.strict_filters?.theme_terms?.includes(value), `${fixture.prompt} missing strict theme term ${value}`));
    }
    if (Array.isArray(expected.strictExpandedThemeTerms)) {
      expected.strictExpandedThemeTerms.forEach((value) =>
        assert(parsed.strict_filters?.expanded_theme_terms?.includes(value), `${fixture.prompt} missing strict expanded theme term ${value}`));
    }
    if (expected.attentionLevel) {
      assert.strictEqual(parsed.attention_profile?.level, expected.attentionLevel);
    }
    if (Array.isArray(expected.audienceWatchCompany)) {
      expected.audienceWatchCompany.forEach((value) =>
        assert(parsed.audience_context?.watch_company?.includes(value), `${fixture.prompt} missing watch company ${value}`));
    }
    if (expected.countryHint) {
      assert.strictEqual(parsed.specificity?.country_hint, expected.countryHint);
    }
    if (expected.placeTheme !== undefined) {
      assert.strictEqual(Boolean(parsed.specificity?.place_theme), expected.placeTheme);
    }
    if (expected.awardsHint) {
      assert.deepStrictEqual(parsed.specificity?.awards_hint, expected.awardsHint);
    }
    if (expected.emotionalTolerance) {
      Object.entries(expected.emotionalTolerance).forEach(([key, value]) =>
        assert.strictEqual(parsed.emotional_tolerance?.[key], value, `${fixture.prompt} emotional tolerance ${key} mismatch`));
    }
    if (expected.pacingProfile) {
      Object.entries(expected.pacingProfile).forEach(([key, value]) =>
        assert.strictEqual(parsed.pacing_energy?.[key], value, `${fixture.prompt} pacing profile ${key} mismatch`));
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
