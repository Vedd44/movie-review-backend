const hasValues = (value) => Array.isArray(value) && value.length > 0;

const hasHardConstraints = (intent = {}) => {
  const hard = intent.hard_filters || {};
  return Boolean(
    hard.max_runtime_minutes ||
    (hard.min_runtime_minutes && !(intent.implicit_feature_runtime_floor && hard.min_runtime_minutes === 40)) ||
    hard.min_release_year ||
    hard.max_release_year ||
    hard.time_constraint ||
    hasValues(hard.required_genre_ids) ||
    hasValues(hard.exclude_genre_ids) ||
    hasValues(hard.certification_allowlist) ||
    hard.require_country_relevance ||
    hard.require_awards_relevance
  );
};

// Broad asks benefit from a little more discovery pressure. This does not
// override fit, hard constraints, anchors, or behavioral memory; it only
// strengthens the existing overexposure penalty when the user has left the
// choice deliberately open.
const isBroadDiscoveryRequest = (intent = {}) => {
  const queryType = intent.query_type || "";
  const specificity = intent.specificity || {};

  if (queryType && queryType !== "GENRE_OR_VIBE") return false;
  if (intent.anchors?.title || intent.anchors?.person || intent.entity_anchor) return false;
  if (specificity.title_anchor || specificity.person_anchor || specificity.country_hint || specificity.awards_hint) return false;
  if (specificity.actor_or_director_requested || specificity.title_similarity_requested || specificity.place_theme) return false;
  if (hasHardConstraints(intent)) return false;
  if (hasValues(intent.subject_entities)) return false;
  if (intent.audience_age || (intent.content_safety && intent.content_safety !== "standard")) return false;

  return true;
};

const getExposurePenaltyMultiplier = (intent = {}) =>
  isBroadDiscoveryRequest(intent) ? 1.35 : 1;

module.exports = {
  isBroadDiscoveryRequest,
  getExposurePenaltyMultiplier,
};
