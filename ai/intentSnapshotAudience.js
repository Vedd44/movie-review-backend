const { parseReelbotIntent } = require('./intentParser');

const CHILD_DERIVED_EXCLUSIONS = new Set([27, 53, 80, 10752]);
const REFINEMENTS = new Set(['lighter', 'darker', 'shorter', 'funnier', 'less_intense', 'more_like_this', 'different_angle']);

// Repair only snapshots affected by the former child/childlike substring bug.
// This is not a general snapshot migration or permission to reset constraints.
const repairLegacyAudienceSnapshot = (snapshot, applyRefinement = intent => intent) => {
  if (!snapshot?.guardrails?.child_family_safe || !/\bchild(?:like|ish)\b/i.test(snapshot.raw_prompt || '')) return snapshot;
  const fresh = parseReelbotIntent(snapshot.raw_prompt);
  if (fresh.guardrails.child_family_safe) return snapshot;

  const priorHard = snapshot.hard_filters || {};
  const explicitExclusions = fresh.hard_filters.exclude_genre_ids || [];
  const repairedHard = {
    ...fresh.hard_filters,
    ...priorHard,
    family_safe_only: false,
    exclude_genre_ids: [...new Set([
      ...(priorHard.exclude_genre_ids || []).filter(id => !CHILD_DERIVED_EXCLUSIONS.has(id)),
      ...explicitExclusions,
    ])],
  };
  // Preserve resolved entities/structured anchors and any extra snapshot state.
  // Parsed fields are regenerated because the bad audience contaminated the
  // guardrails, rubrics, expansion, scoring and emotional-tolerance fields.
  let repaired = { ...snapshot, ...fresh, hard_filters: repairedHard };
  const refinementIds = [...String(snapshot.lane_key || '').matchAll(/:refine:([a-z_]+)/g)]
    .map(match => match[1]).filter(id => REFINEMENTS.has(id));
  if (snapshot.refinement?.id && REFINEMENTS.has(snapshot.refinement.id) && !refinementIds.includes(snapshot.refinement.id)) {
    refinementIds.push(snapshot.refinement.id);
  }
  for (const id of refinementIds) {
    repaired = applyRefinement(repaired, snapshot.refinement?.id === id ? snapshot.refinement : { id });
  }
  return {
    ...repaired,
    // Replaying Shorter cannot loosen any already committed bound. Other hard
    // restrictions (years, runtime, required genres, certifications) survive.
    hard_filters: repairedHard,
    lane_key: snapshot.lane_key || repaired.lane_key,
  };
};

module.exports = { repairLegacyAudienceSnapshot };
