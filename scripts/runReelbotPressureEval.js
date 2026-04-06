const evalSuite = require("../ai/internalPressureEvalSuite");
const { parseReelbotIntent } = require("../ai/intentParser");
const { buildRecommendationRetrievalPlan } = require("../ai/recommendationRetrieval");

const summarizeHandling = (intent = {}, plan = {}) => {
  const notes = [];

  if (intent.audience_age) {
    notes.push(`age=${intent.audience_age}`);
  }

  if (intent.content_safety && intent.content_safety !== "standard") {
    notes.push(`safety=${intent.content_safety}`);
  }

  if (Array.isArray(intent.subject_entities) && intent.subject_entities.length) {
    notes.push(`entity=${intent.subject_entities.join(", ")}`);
  }

  if (Array.isArray(intent.watch_context) && intent.watch_context.length) {
    notes.push(`context=${intent.watch_context.join(", ")}`);
  }

  if (plan.family_safe_bias) {
    notes.push("family-safe retrieval bias");
  }

  if (Array.isArray(plan.movie_query_terms) && plan.movie_query_terms.length) {
    notes.push(`movie queries: ${plan.movie_query_terms.slice(0, 4).join(", ")}`);
  } else {
    notes.push("no title/entity-heavy movie queries");
  }

  if (Array.isArray(plan.keyword_terms) && plan.keyword_terms.length) {
    notes.push(`keyword expansion: ${plan.keyword_terms.slice(0, 4).join(", ")}`);
  }

  return notes.join(" | ");
};

evalSuite.forEach((entry, index) => {
  const intent = parseReelbotIntent(entry.prompt);
  const plan = buildRecommendationRetrievalPlan(intent);

  console.log(`${index + 1}. [${entry.category}] ${entry.prompt}`);
  console.log(`   Expected: ${entry.expectedTopPicks.join(", ")}`);
  console.log(`   False positives: ${entry.likelyFalsePositives.join(", ")}`);
  console.log(`   Pipeline: ${summarizeHandling(intent, plan)}`);
  console.log(`   Risk: ${entry.likelyWeakness}`);
  console.log("");
});
