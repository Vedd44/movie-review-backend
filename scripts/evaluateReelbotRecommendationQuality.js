const assert = require("assert");
const fixtures = require("../ai/recommendationQualityFixtures");
const { parseReelbotIntent } = require("../ai/intentParser");
const { getRecommendationFitBreakdown } = require("../ai/recommendationScoring");

const failures = [];

fixtures.forEach((fixture) => {
  const intent = parseReelbotIntent(fixture.prompt);
  const ranked = fixture.candidates
    .map((movie) => ({
      title: movie.title,
      breakdown: getRecommendationFitBreakdown(movie, intent, { structured_match_score: movie.structured_match_score || 0 }),
    }))
    .sort((left, right) => right.breakdown.total - left.breakdown.total);

  const top = ranked[0];
  const topThreeTitles = ranked.slice(0, 3).map((entry) => entry.title);

  try {
    assert(top, `${fixture.prompt} produced no ranked candidate`);
    assert.notStrictEqual(top.breakdown.fit_tier, "no_fit", `${fixture.prompt} top result was still no_fit`);
    assert(
      fixture.acceptedTopTitles.includes(top.title),
      `${fixture.prompt} picked ${top.title} instead of one of ${fixture.acceptedTopTitles.join(", ")}`
    );

    if (Array.isArray(fixture.expectedTopThree)) {
      fixture.expectedTopThree.forEach((title) => {
        assert(topThreeTitles.includes(title), `${fixture.prompt} top three missing ${title}`);
      });
    }
  } catch (error) {
    failures.push({
      prompt: fixture.prompt,
      error: error.message,
      ranked: ranked.slice(0, 5).map((entry) => ({
        title: entry.title,
        fit_tier: entry.breakdown.fit_tier,
        total: entry.breakdown.total,
        components: entry.breakdown.components,
      })),
    });
  }
});

if (failures.length) {
  console.error("ReelBot recommendation quality evaluation failed:");
  failures.forEach((failure) => {
    console.error(`- ${failure.prompt}: ${failure.error}`);
    console.error(`  Ranked: ${JSON.stringify(failure.ranked)}`);
  });
  process.exit(1);
}

console.log(`ReelBot recommendation quality evaluation passed for ${fixtures.length} prompts.`);
