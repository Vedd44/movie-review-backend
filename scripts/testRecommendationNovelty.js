const assert = require("assert");
const { isBroadDiscoveryRequest, getExposurePenaltyMultiplier } = require("../ai/recommendationNovelty");

const broad = {
  query_type: "GENRE_OR_VIBE",
  hard_filters: {},
  specificity: {},
  subject_entities: [],
  content_safety: "standard",
};
assert.strictEqual(isBroadDiscoveryRequest(broad), true);
assert.strictEqual(getExposurePenaltyMultiplier(broad), 1.35);

assert.strictEqual(isBroadDiscoveryRequest({
  ...broad,
  hard_filters: { max_runtime_minutes: 120 },
}), false);

assert.strictEqual(isBroadDiscoveryRequest({
  ...broad,
  anchors: { title: "Alien" },
}), false);

assert.strictEqual(isBroadDiscoveryRequest({
  ...broad,
  query_type: "TITLE_SIMILARITY",
}), false);

assert.strictEqual(isBroadDiscoveryRequest({
  ...broad,
  audience_age: "young_kids",
}), false);

assert.strictEqual(isBroadDiscoveryRequest({
  ...broad,
  subject_entities: ["rabbit"],
}), false);

assert.strictEqual(getExposurePenaltyMultiplier({
  ...broad,
  hard_filters: { required_genre_ids: [35] },
}), 1);

console.log("recommendation novelty tests passed");
