const { deriveMovieSignals } = require("./movieSignals");
const { CANONICAL_ENTITY_ENTRY_TITLES } = require("./curatedRecommendationSignals");

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const SUPPORTIVE_YOUNG_AUDIENCE_GENRES = new Set([16, 10751, 35, 12, 14, 10402]);

const getSoftPreferences = (intent = {}) =>
  Array.isArray(intent.soft_preferences)
    ? intent.soft_preferences
    : Array.isArray(intent.soft_preferences?.preference_signals)
      ? intent.soft_preferences.preference_signals
      : [];

const hasConsensusAsk = (intent = {}) => {
  const softPreferences = getSoftPreferences(intent);
  return softPreferences.includes("low_regret")
    || softPreferences.includes("broadly_accessible")
    || softPreferences.includes("consensus_friendly")
    || softPreferences.includes("rewatchable")
    || Array.isArray(intent.tone_preferences) && intent.tone_preferences.includes("accessible");
};

const hasCozyAsk = (intent = {}) => {
  const softPreferences = getSoftPreferences(intent);
  return softPreferences.includes("comforting")
    || softPreferences.includes("warm")
    || softPreferences.includes("low_conflict")
    || softPreferences.includes("calm")
    || Array.isArray(intent.tone_preferences) && (intent.tone_preferences.includes("cozy") || intent.tone_preferences.includes("gentle"));
};

const hasSweepingEpicAsk = (intent = {}) => {
  const softPreferences = getSoftPreferences(intent);
  return softPreferences.includes("historical_sweep")
    || softPreferences.includes("nature_scale")
    || softPreferences.includes("romantic_prestige")
    || softPreferences.includes("immersive")
    || Boolean(intent.specificity?.title_similarity_requested && intent.anchors?.title);
};

const getBestEntityScore = (signals = {}, subjectEntities = []) =>
  (Array.isArray(subjectEntities) ? subjectEntities : []).reduce(
    (highest, entity) => Math.max(highest, Number(signals.entity_scores?.[entity] || 0)),
    0
  );

const getEntityScore = (signals = {}, subjectEntities = [], matchType = "meaningful_presence") => {
  if (!Array.isArray(subjectEntities) || !subjectEntities.length) {
    return { score: 0, label: "not_applicable" };
  }

  const bestScore = getBestEntityScore(signals, subjectEntities);
  const threshold = matchType === "central_presence" ? 0.78 : matchType === "meaningful_presence" ? 0.42 : 0.2;

  if (bestScore >= 0.95) return { score: 88, label: "primary" };
  if (bestScore >= 0.78) return { score: 72, label: "meaningful" };
  if (bestScore >= threshold) return { score: 44, label: "secondary" };
  if (bestScore > 0) return { score: 14, label: "incidental" };
  return { score: -58, label: "missing" };
};

const getAudienceFitScore = (signals = {}, intent = {}) => {
  const age = intent.audience_age || intent.age_fit || null;
  switch (age) {
    case "toddler":
      return Math.round((signals.toddler_friendliness - 0.45) * 120);
    case "preschool":
      return Math.round((((signals.toddler_friendliness + signals.kid_friendliness) / 2) - 0.45) * 110);
    case "young_kids":
      return Math.round((signals.kid_friendliness - 0.42) * 100);
    case "older_kids":
    case "tweens":
    case "broad_family":
      return Math.round((signals.kid_friendliness - 0.35) * 82);
    default:
      return 0;
  }
};

const getSafetyScore = (signals = {}, intent = {}) => {
  const safetyLevel = intent.content_safety || "standard";
  const safetyComposite = 1 - ((signals.scariness + signals.peril) / 2);
  if (safetyLevel === "very_safe") return Math.round((safetyComposite - 0.42) * 120);
  if (safetyLevel === "safe") return Math.round((safetyComposite - 0.36) * 100);
  return Math.round((safetyComposite - 0.3) * 50);
};

const getToneScore = (signals = {}, intent = {}) => {
  const tonePreferences = Array.isArray(intent.tone_preferences) ? intent.tone_preferences : [];
  const softPreferences = getSoftPreferences(intent);
  const vibeTags = new Set(Array.isArray(signals.vibe_tags) ? signals.vibe_tags : []);
  let score = 0;

  if (!tonePreferences.length && !softPreferences.length) {
    return 0;
  }

  tonePreferences.forEach((tag) => {
    if (vibeTags.has(tag)) {
      score += 12;
    }
  });

  softPreferences.forEach((tag) => {
    if (tag === "low_stimulation" && Number(signals.stimulation_level || 0) <= 0.35) score += 12;
    if (tag === "low_peril" && Number(signals.peril || 0) <= 0.2) score += 12;
    if (tag === "family_friendly" && Number(signals.kid_friendliness || 0) >= 0.62) score += 10;
    if (tag === "broadly_accessible" && Number(signals.stimulation_level || 0) <= 0.55) score += 8;
    if (tag === "immersive" && Array.isArray(signals.practical_watch_fit) && signals.practical_watch_fit.includes("full_attention")) score += 8;
    if (tag === "clear_storytelling" && Number(signals.stimulation_level || 0) <= 0.55) score += 6;
    if (tag === "consensus_friendly" && Number(signals.consensus_friendliness || 0) >= 0.58) score += 14;
    if (tag === "rewatchable" && Number(signals.rewatchability || 0) >= 0.54) score += 8;
    if (tag === "comforting" && Number(signals.cozy_score || 0) >= 0.54) score += 14;
    if (tag === "warm" && Number(signals.warmth_score || 0) >= 0.56) score += 10;
    if (tag === "low_conflict" && Number(signals.peril || 0) <= 0.16 && Number(signals.emotional_intensity || 0) <= 0.54) score += 12;
    if (tag === "historical_sweep" && Number(signals.sweeping_epic_score || 0) >= 0.54) score += 16;
    if (tag === "nature_scale" && Number(signals.sweeping_epic_score || 0) >= 0.5) score += 10;
    if (tag === "romantic_prestige" && Number(signals.sweeping_epic_score || 0) >= 0.58) score += 10;
  });

  if (softPreferences.includes("immersive")) {
    if (Number(signals.emotional_intensity || 0) >= 0.35) score += 8;
  }

  return score;
};

const getConsensusScore = (movie = {}, signals = {}, intent = {}) => {
  if (!hasConsensusAsk(intent)) {
    return 0;
  }

  const genreIds = Array.isArray(movie.genre_ids) ? movie.genre_ids : [];
  let score = 0;
  score += Math.round((Number(signals.consensus_friendliness || 0) - 0.4) * 70);
  score += Math.round((Number(signals.rewatchability || 0) - 0.35) * 32);
  score -= Math.round(Number(signals.confusion_risk || 0) * 28);
  score -= Math.round(Number(signals.polarization_risk || 0) * 30);

  if (Number(movie.vote_count || 0) >= 5000) score += 10;
  if (Number(movie.popularity || 0) >= 45) score += 8;
  if (Array.isArray(signals.practical_watch_fit) && signals.practical_watch_fit.includes("easy_group_watch")) score += 10;
  if (!intent.audience_age && (genreIds.includes(16) || genreIds.includes(10751))) score -= 18;

  return score;
};

const getCozyScore = (signals = {}, intent = {}) => {
  if (!hasCozyAsk(intent)) {
    return 0;
  }

  let score = 0;
  score += Math.round((Number(signals.cozy_score || 0) - 0.36) * 58);
  score += Math.round((Number(signals.warmth_score || 0) - 0.34) * 40);
  if (Array.isArray(signals.practical_watch_fit) && signals.practical_watch_fit.includes("comfort_watch")) score += 10;
  if (Number(signals.stimulation_level || 0) <= 0.34) score += 8;
  if (Number(signals.peril || 0) <= 0.16) score += 8;
  return score;
};

const getSweepingEpicScore = (movie = {}, signals = {}, intent = {}) => {
  if (!hasSweepingEpicAsk(intent)) {
    return 0;
  }

  const genreIds = Array.isArray(movie.genre_ids) ? movie.genre_ids : [];
  let score = 0;
  score += Math.round((Number(signals.sweeping_epic_score || 0) - 0.28) * 72);
  if (genreIds.includes(36) || genreIds.includes(10749)) score += 10;
  if (genreIds.includes(18) && Number(movie.runtime || 0) >= 120) score += 8;
  if (Array.isArray(signals.practical_watch_fit) && signals.practical_watch_fit.includes("immersive_epic")) score += 10;
  if (genreIds.includes(28) && !genreIds.includes(36) && !genreIds.includes(10749)) score -= 12;
  if (genreIds.includes(878)) score -= 10;
  return score;
};

const getCanonicalEntryScore = (movie = {}, signals = {}, intent = {}) => {
  const prefersCanonicalEntry =
    (Array.isArray(intent.subject_entities) && intent.subject_entities.length > 0)
    || ["toddler", "preschool", "young_kids", "broad_family"].includes(intent.audience_age)
    || hasConsensusAsk(intent);

  if (!prefersCanonicalEntry) {
    return 0;
  }

  const canonicalEntityTitle = (Array.isArray(intent.subject_entities) ? intent.subject_entities : [])
    .map((entity) => CANONICAL_ENTITY_ENTRY_TITLES[entity])
    .find(Boolean);
  if (canonicalEntityTitle && String(movie.title || "").trim().toLowerCase() === canonicalEntityTitle.toLowerCase()) {
    return 28;
  }

  const isSequel = Boolean(signals.series_metadata?.is_sequel);
  if (isSequel) {
    return ["toddler", "preschool", "young_kids"].includes(intent.audience_age) || Array.isArray(intent.subject_entities) && intent.subject_entities.length
      ? -22
      : -14;
  }

  if (signals.series_metadata?.series_root && Number(movie.popularity || 0) >= 20) {
    return 8;
  }

  return 0;
};

const getContextScore = (signals = {}, intent = {}) => {
  const watchContext = Array.isArray(intent.watch_context) ? intent.watch_context : [];
  const practicalFit = new Set(Array.isArray(signals.practical_watch_fit) ? signals.practical_watch_fit : []);
  let score = 0;

  if (watchContext.includes("comfort_watch") && practicalFit.has("family_safe")) score += 12;
  if (watchContext.includes("group_watch") && practicalFit.has("easy_group_watch")) score += 10;
  if (watchContext.includes("family") && practicalFit.has("family_safe")) score += 10;
  if (intent.attention_profile?.level === "background" && practicalFit.has("background_friendly")) score += 12;
  if (intent.attention_profile?.level === "immersive" && practicalFit.has("full_attention")) score += 8;

  return score;
};

const getLowRegretScore = (movie = {}, signals = {}) => {
  let score = 0;
  score += Math.min(Number(movie.popularity || 0), 120) / 8;
  score += Math.min(Number(movie.vote_count || 0), 500) / 28;
  score += Math.max(0, Number(movie.vote_average || 0) - 6.2) * 6;

  if (signals.kid_friendliness >= 0.72 && (movie.popularity || 0) >= 25) {
    score += 8;
  }

  score += Number(signals.consensus_friendliness || 0) * 12;
  score -= Number(signals.confusion_risk || 0) * 8;

  return Math.round(score);
};

const getPenaltyAdjustments = (movie = {}, signals = {}, intent = {}) => {
  const penalties = [];
  let total = 0;
  const subjectEntities = Array.isArray(intent.subject_entities) ? intent.subject_entities : [];
  const bestEntityScore = getBestEntityScore(signals, subjectEntities);
  const subjectThreshold =
    intent.subject_match_type === "central_presence"
      ? 0.78
      : intent.subject_match_type === "meaningful_presence"
        ? 0.42
        : 0.2;
  const softPreferences = getSoftPreferences(intent);

  if ((intent.audience_age === "toddler" || intent.audience_age === "preschool") && signals.toddler_friendliness < 0.42) {
    total -= 85;
    penalties.push("toddler_fit_miss");
  }

  if ((intent.audience_age === "toddler" || intent.audience_age === "preschool") && Number(movie.runtime || 0) > 100) {
    total -= 18;
    penalties.push("too_busy_for_toddler_lane");
  }

  if ((intent.audience_age === "toddler" || intent.audience_age === "preschool") && signals.stimulation_level > 0.42) {
    total -= 18;
    penalties.push("stimulation_too_high");
  }

  if ((intent.audience_age === "toddler" || intent.audience_age === "preschool" || intent.audience_age === "young_kids")) {
    const genreIds = Array.isArray(movie.genre_ids) ? movie.genre_ids : [];
    if (!genreIds.some((genreId) => SUPPORTIVE_YOUNG_AUDIENCE_GENRES.has(genreId))) {
      total -= 32;
      penalties.push("not_reliably_kids_coded");
    }

    if ((movie.popularity || 0) < 10 && (movie.vote_count || 0) < 120) {
      total -= 24;
      penalties.push("low_recognition_for_family_prompt");
    }

    if (Number(movie.runtime || 0) && Number(movie.runtime || 0) < 65) {
      total -= 14;
      penalties.push("too_slight_for_feature_pick");
    }
  }

  if (intent.content_safety === "very_safe" && (signals.scariness > 0.28 || signals.peril > 0.3)) {
    total -= 60;
    penalties.push("safety_miss");
  }

  if (subjectEntities.length && bestEntityScore <= 0) {
    total -= intent.subject_match_type === "central_presence"
      ? 132
      : intent.subject_match_type === "meaningful_presence"
        ? 118
        : 88;
    penalties.push("subject_missing");
  }

  if (subjectEntities.length && bestEntityScore > 0 && bestEntityScore < subjectThreshold) {
    total -= intent.subject_match_type === "central_presence" ? 46 : 32;
    penalties.push("subject_too_incidental");
  }

  if (softPreferences.includes("low_stimulation") && signals.stimulation_level > 0.58) {
    total -= 22;
    penalties.push("too_chaotic");
  }

  if (softPreferences.includes("consensus_friendly") && (Number(signals.confusion_risk || 0) > 0.46 || Number(signals.polarization_risk || 0) > 0.46)) {
    total -= 26;
    penalties.push("too_polarizing_for_consensus");
  }

  if ((softPreferences.includes("consensus_friendly") || softPreferences.includes("broadly_accessible") || softPreferences.includes("low_regret")) && !intent.audience_age) {
    const genreIds = Array.isArray(movie.genre_ids) ? movie.genre_ids : [];
    if (genreIds.includes(16) || genreIds.includes(10751)) {
      total -= 28;
      penalties.push("too_kids_coded_for_general_consensus");
    }
    if ((movie.popularity || 0) < 20 && (movie.vote_count || 0) < 500) {
      total -= 18;
      penalties.push("too_obscure_for_consensus_pick");
    }
  }

  if ((softPreferences.includes("comforting") || softPreferences.includes("warm") || softPreferences.includes("low_conflict")) && Number(signals.cozy_score || 0) < 0.42) {
    total -= 24;
    penalties.push("not_cozy_enough");
  }

  if ((softPreferences.includes("comforting") || softPreferences.includes("warm") || softPreferences.includes("low_conflict")) && !intent.audience_age) {
    const genreIds = Array.isArray(movie.genre_ids) ? movie.genre_ids : [];
    if ((genreIds.includes(16) || genreIds.includes(10751)) && !signals.curated_title_signals?.cozy_adult) {
      total -= 24;
      penalties.push("too_child_coded_for_adult_cozy");
    }
    if ((movie.popularity || 0) < 18 && (movie.vote_count || 0) < 400) {
      total -= 16;
      penalties.push("too_obscure_for_trustworthy_cozy_pick");
    }
  }

  if ((softPreferences.includes("comforting") || softPreferences.includes("warm") || softPreferences.includes("low_conflict")) && Number(signals.stimulation_level || 0) > 0.42) {
    total -= 22;
    penalties.push("too_energetic_for_cozy_lane");
  }

  if ((softPreferences.includes("comforting") || softPreferences.includes("warm") || softPreferences.includes("low_conflict")) && !(Array.isArray(signals.practical_watch_fit) && signals.practical_watch_fit.includes("comfort_watch"))) {
    total -= 16;
    penalties.push("not_settled_enough_for_quiet_night");
  }

  if (softPreferences.includes("accessible") && Array.isArray(signals.practical_watch_fit) && signals.practical_watch_fit.includes("patience_required")) {
    total -= 12;
    penalties.push("more_demanding_than_asked");
  }

  if (softPreferences.includes("immersive")) {
    const genreIds = Array.isArray(movie.genre_ids) ? movie.genre_ids : [];
    const hasHistoricalOrRomanticSweep = genreIds.includes(36) || genreIds.includes(10749) || genreIds.includes(18) || Number(movie.runtime || 0) >= 128;
    if (hasHistoricalOrRomanticSweep) {
      total += 18;
    } else if (genreIds.includes(28) || genreIds.includes(878)) {
      total -= 16;
      penalties.push("too_action_forward_for_sweeping_lane");
    }
  }

  if ((softPreferences.includes("historical_sweep") || softPreferences.includes("nature_scale") || softPreferences.includes("romantic_prestige")) && Number(signals.sweeping_epic_score || 0) < 0.4) {
    total -= 30;
    penalties.push("not_sweeping_enough");
  }

  if (String(movie.us_certification || "").toUpperCase() === "R" && intent.content_safety && intent.content_safety !== "standard") {
    total -= 80;
    penalties.push("certification_miss");
  }

  return { total, penalties };
};

const getFitTier = (totalScore) => {
  if (totalScore >= 132) return "exact_fit";
  if (totalScore >= 102) return "strong_fit";
  if (totalScore >= 72) return "decent_fit";
  if (totalScore >= 42) return "weak_fit";
  return "no_fit";
};

const getRecommendationFitBreakdown = (movie = {}, intent = {}, extra = {}) => {
  const signals = deriveMovieSignals(movie);
  const entity = getEntityScore(signals, intent.subject_entities, intent.subject_match_type);
  const audience = getAudienceFitScore(signals, intent);
  const safety = getSafetyScore(signals, intent);
  const tone = getToneScore(signals, intent);
  const consensus = getConsensusScore(movie, signals, intent);
  const cozy = getCozyScore(signals, intent);
  const sweepingEpic = getSweepingEpicScore(movie, signals, intent);
  const canonicalEntry = getCanonicalEntryScore(movie, signals, intent);
  const context = getContextScore(signals, intent);
  const lowRegret = getLowRegretScore(movie, signals);
  const penalties = getPenaltyAdjustments(movie, signals, intent);
  const bonus = clamp(Number(extra.structured_match_score || movie.structured_match_score || 0) / 20, 0, 18);

  const total = entity.score + audience + safety + tone + consensus + cozy + sweepingEpic + canonicalEntry + context + lowRegret + bonus + penalties.total;
  const fitTier = getFitTier(total);

  return {
    total,
    fit_tier: fitTier,
    confidence_label: fitTier === "exact_fit" || fitTier === "strong_fit" ? "high" : fitTier === "decent_fit" ? "medium" : "low",
    components: {
      entity_match: entity.score,
      audience_fit: audience,
      safety_fit: safety,
      tone_fit: tone,
      consensus_fit: consensus,
      cozy_fit: cozy,
      sweeping_fit: sweepingEpic,
      canonical_entry: canonicalEntry,
      watch_context_fit: context,
      low_regret: lowRegret,
      structured_bonus: bonus,
      penalties: penalties.total,
    },
    entity_match_label: entity.label,
    penalties: penalties.penalties,
    derived_signals: signals,
  };
};

module.exports = {
  getRecommendationFitBreakdown,
  getFitTier,
};
