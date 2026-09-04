const assert = require("node:assert/strict");
const { parseReelbotIntent } = require("../ai/intentParser");
const { getRecommendationFitBreakdown } = require("../ai/recommendationScoring");
const fixtures = require("../ai/interactionHardeningFixtures");
const { ASK_INTENTS, classifyAskIntent } = require("../src/ask/askIntent");
const { updateConversationForPrompt, buildContextualRecommendationPrompt, getConversationExcludedIds } = require("../src/ask/conversationState");

const parsed = Object.fromEntries(fixtures.map((fixture) => [fixture.id, parseReelbotIntent(fixture.prompt)]));
assert.equal(parsed.lighter_soft_runtime_action.constraint_priority.requested_tone, "lighter");
assert.equal(parsed.lighter_soft_runtime_action.constraint_priority.cognitive_load, "easy");
assert.equal(parsed.lighter_soft_runtime_action.runtime_commitment.strength, "soft");
assert.equal(parsed.lighter_soft_runtime_action.hard_filters.max_runtime_minutes, null);
assert.equal(parsed.lighter_soft_runtime_action.hard_filters.min_runtime_minutes, null);
assert.equal(parseReelbotIntent("action under 100 minutes").hard_filters.max_runtime_minutes, 100);
assert.equal(parseReelbotIntent("action under 100 minutes").runtime_commitment.strength, "hard");
assert.equal(parsed.spooky_but_safe.content_safety, "safe");
assert.equal(parsed.serious_not_depressing.emotional_tolerance.avoid_depressing, true);
assert.ok(parsed.funny_not_dumb.soft_preferences.preference_signals.includes("thoughtful"));

const lightAction = { id: 1, title: "Light Action", genre_ids: [28, 35, 12], runtime: 115, overview: "A playful, fun adventure with clear storytelling.", vote_count: 2000, popularity: 50, vote_average: 7 };
const darkShortAction = { id: 2, title: "Dark Horror Action", genre_ids: [28, 27, 53], runtime: 90, overview: "A bleak killer nightmare full of gore and trauma.", vote_count: 2000, popularity: 50, vote_average: 7 };
const lightScore = getRecommendationFitBreakdown(lightAction, parsed.lighter_soft_runtime_action).total;
const darkScore = getRecommendationFitBreakdown(darkShortAction, parsed.lighter_soft_runtime_action).total;
assert.ok(lightScore > darkScore + 100, `lighter action should dominate runtime shortcut (${lightScore} vs ${darkScore})`);

let state = updateConversationForPrompt({}, "Give me something like Alien but less scary", ASK_INTENTS.GENERAL_RECOMMENDATION, { page: "general" });
assert.equal(classifyAskIntent({ prompt: "No, lighter rather than shorter", context: { page: "general" }, conversation: state }), ASK_INTENTS.REFINE_RECOMMENDATION);
state = updateConversationForPrompt(state, "No, lighter rather than shorter", ASK_INTENTS.REFINE_RECOMMENDATION, { page: "general" });
assert.equal(state.activeConstraints.priority, "tone");
assert.match(buildContextualRecommendationPrompt("Another one", state, ASK_INTENTS.NEXT_RECOMMENDATION), /Alien.*Correction: No, lighter rather than shorter/i);
assert.equal(classifyAskIntent({ prompt: "Another one", context: { page: "general" }, conversation: state }), ASK_INTENTS.NEXT_RECOMMENDATION);
assert.deepEqual(getConversationExcludedIds({ recommendationHistory: [
  { id: 10, title: "First", status: "recommended" },
  { id: 11, title: "Second", status: "rejected" },
] }), [10, 11]);
const rejectedState = updateConversationForPrompt({ recommendationHistory: [{ id: 10, title: "First", status: "recommended" }], activeRequest: "easy action" }, "Not that one", ASK_INTENTS.REFINE_RECOMMENDATION, { page: "general" });
assert.equal(rejectedState.recommendationHistory[0].status, "rejected");

let movieQuestion = updateConversationForPrompt({ anchorMovie: { id: 1, title: "Coyote vs. Acme" } }, "Is Coyote vs. Acme scary?", ASK_INTENTS.CURRENT_MOVIE_QUESTION, { page: "general" });
assert.equal(classifyAskIntent({ prompt: "What about for a 7 year old?", context: { page: "general" }, conversation: movieQuestion }), ASK_INTENTS.CURRENT_MOVIE_QUESTION);
let directorQuestion = updateConversationForPrompt({ anchorMovie: { id: 2, title: "A Movie" } }, "Who directed this?", ASK_INTENTS.CURRENT_MOVIE_QUESTION, { page: "movie_detail" });
assert.equal(classifyAskIntent({ prompt: "What else has he done?", context: { page: "movie_detail" }, conversation: directorQuestion }), ASK_INTENTS.CURRENT_MOVIE_QUESTION);
let smartEasy = updateConversationForPrompt({}, "Something smart but easy", ASK_INTENTS.GENERAL_RECOMMENDATION, { page: "general" });
smartEasy = updateConversationForPrompt(smartEasy, "More mainstream", ASK_INTENTS.REFINE_RECOMMENDATION, { page: "general" });
assert.ok(smartEasy.activeConstraints.secondary.includes("mainstream"));
assert.equal(smartEasy.activeRequest, "Something smart but easy");
assert.match(buildContextualRecommendationPrompt("Another", smartEasy, ASK_INTENTS.NEXT_RECOMMENDATION), /smart but easy.*More mainstream/i);
assert.equal(classifyAskIntent({ prompt: "Another", context: { page: "general" }, conversation: smartEasy }), ASK_INTENTS.NEXT_RECOMMENDATION);

console.log("Interaction hardening parsing, priority, and multi-turn checks passed.");
