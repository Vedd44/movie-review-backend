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
