const { SUBJECT_ENTITY_RULES } = require("./queryExpansion");
const { getCuratedTitleSignals } = require("./curatedRecommendationSignals");

const compact = (value = "") => String(value || "").replace(/\s+/g, " ").trim();
const lower = (value = "") => compact(value).toLowerCase();
const uniqueStrings = (values = []) => [...new Set((Array.isArray(values) ? values : []).map((value) => compact(value)).filter(Boolean))];

const SUPPORTIVE_KIDS_GENRES = new Set([16, 10751, 35, 12, 14, 10402]);
const BLOCKED_KIDS_GENRES = new Set([27, 53, 80, 10752]);
const HIGH_PERIL_PATTERN =
  /\bhorror|slasher|serial killer|killer|murder|violent|violence|blood|gore|war|battlefield|combat|assassin|revenge|gangster|drug cartel|terror|hostage|kidnap|bleak|grief|mourning|trauma|abuse|suicide|sexual|erotic|post-apocalyptic|apocalypse|disaster|zombie\b/i;
const MODERATE_PERIL_PATTERN =
  /\bmonster|ghost|haunted|spooky|creepy|danger|peril|chase|villain|scary|intense|battle|fight|chaos|chaotic\b/i;
const GENTLE_PATTERN = /\bgentle|warm|cozy|soft|friendly|friendship|playful|family|fun|adventure|musical|lighthearted\b/i;
const BRIGHT_PATTERN = /\bbright|cheerful|sunny|whimsical|silly|spring|joyful\b/i;
const SMART_PATTERN = /\bsmart|clever|thoughtful|inventive|brainy|idea\b/i;
const COZY_PATTERN = /\bcozy|cosy|warm|comfort|comforting|quiet|gentle|soft|humane|soothing|tender|kind|homey|low-key|low key\b/i;
const CONSENSUS_PATTERN = /\bcrowd-pleas|accessible|rewatchable|uplifting|feel-good|feel good|witty|broad|easygoing|agreeable|movie night\b/i;
const CONFUSION_PATTERN = /\bnonlinear|mind-bending|opaque|labyrinth|puzzle-box|puzzle box|surreal|dense|heady|fragmented|elliptical\b/i;
const POLARIZING_PATTERN = /\bpunishing|abrasive|alienating|nihilistic|bleak|harsh|divisive|unsettling|experimental\b/i;
const HISTORICAL_SWEEP_PATTERN = /\bfrontier|wilderness|landscape|period|historical|colonial|civil war|old west|frontier life|expansive|sweeping|epic\b/i;
const ROMANTIC_SWEEP_PATTERN = /\bromance|romantic|longing|passion|love story|yearning\b/i;
const PRESTIGE_DRAMA_PATTERN = /\bprestige|lyrical|contemplative|elegant|stately|meditative\b/i;

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const getSeriesMetadata = (movie = {}) => {
  const title = compact(movie.title || "");
  const normalizedTitle = lower(title);
  const sequelMatch =
    normalizedTitle.match(/\b(\d+)\b/)
    || normalizedTitle.match(/\b(ii|iii|iv|v|vi)\b/)
    || normalizedTitle.match(/\bpart\s+(\d+)\b/);
  const isSequel = Boolean(
    sequelMatch
    || /\bchapter\b|\breturns\b|\bagain\b|\bthe runaway\b|\bscamp'?s adventure\b|\blondon adventure\b/i.test(title)
  );
  const seriesRoot = compact(
    title
      .replace(/\s*[:\-]\s*.*$/, "")
      .replace(/\s+\b(?:part\s+\d+|\d+|ii|iii|iv|v|vi)\b.*$/i, "")
      .replace(/\breturns\b.*$/i, "")
      .replace(/\bagain\b.*$/i, "")
  );

  return {
    is_sequel: isSequel,
    series_root: seriesRoot || title,
  };
};

const getSearchableParts = (movie = {}) => {
  const keywordNames = Array.isArray(movie.keyword_names)
    ? movie.keyword_names
    : Array.isArray(movie.keywords?.keywords)
      ? movie.keywords.keywords.map((entry) => entry?.name).filter(Boolean)
      : [];

  const searchableText = lower([
    movie.title,
    movie.overview,
    movie.tagline,
    ...(Array.isArray(movie.structured_match_reasons) ? movie.structured_match_reasons : []),
    ...keywordNames,
  ].filter(Boolean).join(" "));

  return {
    titleText: lower(movie.title),
    searchableText,
    keywordNames,
  };
};

const getEntityProminence = (parts, rule) => {
  const aliasMatches = rule.aliases.filter((alias) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(parts.searchableText));
  const titleHintMatch = rule.title_hints.some((hint) => parts.titleText.includes(lower(hint)));
  const titleAliasMatch = rule.aliases.some((alias) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(parts.titleText));
  const keywordHit = parts.keywordNames.some((keyword) => rule.aliases.some((alias) => lower(keyword).includes(alias)));

  if (titleHintMatch || titleAliasMatch) {
    return { level: "primary", score: 1 };
  }

  if (aliasMatches.length >= 2 || (aliasMatches.length >= 1 && keywordHit)) {
    return { level: "meaningful", score: 0.82 };
  }

  if (aliasMatches.length === 1 || keywordHit) {
    return { level: "secondary", score: 0.48 };
  }

  return { level: "none", score: 0 };
};

const deriveAudienceScores = (movie = {}, parts = {}) => {
  const genreIds = new Set(Array.isArray(movie.genre_ids) ? movie.genre_ids : []);
  const certification = String(movie.us_certification || "").trim().toUpperCase();
  const runtime = Number(movie.runtime || 0);
  let kidFriendliness = 0.45;
  let toddlerFriendliness = 0.35;

  if ([...genreIds].some((genreId) => SUPPORTIVE_KIDS_GENRES.has(genreId))) {
    kidFriendliness += 0.22;
    toddlerFriendliness += 0.18;
  }

  if (genreIds.has(16) || genreIds.has(10751)) {
    kidFriendliness += 0.18;
    toddlerFriendliness += 0.18;
  }

  if (genreIds.has(35) || genreIds.has(10402)) {
    kidFriendliness += 0.08;
    toddlerFriendliness += 0.08;
  }

  if (certification === "G") {
    kidFriendliness += 0.15;
    toddlerFriendliness += 0.2;
  } else if (certification === "PG") {
    kidFriendliness += 0.08;
    toddlerFriendliness += 0.02;
  } else if (certification === "PG-13") {
    kidFriendliness -= 0.18;
    toddlerFriendliness -= 0.28;
  } else if (certification === "R" || certification === "NC-17") {
    kidFriendliness -= 0.4;
    toddlerFriendliness -= 0.5;
  }

  if (runtime && runtime <= 95) {
    toddlerFriendliness += 0.08;
  } else if (runtime > 125) {
    toddlerFriendliness -= 0.18;
    kidFriendliness -= 0.08;
  }

  if (HIGH_PERIL_PATTERN.test(parts.searchableText) || [...genreIds].some((genreId) => BLOCKED_KIDS_GENRES.has(genreId))) {
    kidFriendliness -= 0.5;
    toddlerFriendliness -= 0.58;
  } else if (MODERATE_PERIL_PATTERN.test(parts.searchableText)) {
    kidFriendliness -= 0.16;
    toddlerFriendliness -= 0.22;
  }

  if (GENTLE_PATTERN.test(parts.searchableText)) {
    kidFriendliness += 0.08;
    toddlerFriendliness += 0.12;
  }

  return {
    kid_friendliness: clamp(kidFriendliness),
    toddler_friendliness: clamp(toddlerFriendliness),
  };
};

const deriveIntensityScores = (parts = {}, movie = {}) => {
  const genreIds = new Set(Array.isArray(movie.genre_ids) ? movie.genre_ids : []);
  let scariness = 0.08;
  let peril = 0.12;
  let emotionalIntensity = 0.28;
  let stimulation = 0.35;

  if (HIGH_PERIL_PATTERN.test(parts.searchableText)) {
    scariness += 0.52;
    peril += 0.5;
    emotionalIntensity += 0.2;
  } else if (MODERATE_PERIL_PATTERN.test(parts.searchableText)) {
    scariness += 0.18;
    peril += 0.22;
  }

  if (genreIds.has(27)) {
    scariness += 0.45;
    peril += 0.28;
  }
  if (genreIds.has(53) || genreIds.has(28) || genreIds.has(80)) {
    peril += 0.2;
    stimulation += 0.18;
  }
  if (genreIds.has(18)) {
    emotionalIntensity += 0.16;
  }
  if (genreIds.has(35) || genreIds.has(10751) || genreIds.has(16)) {
    scariness -= 0.08;
    peril -= 0.08;
    stimulation -= 0.04;
  }
  if (GENTLE_PATTERN.test(parts.searchableText)) {
    peril -= 0.08;
    emotionalIntensity -= 0.05;
    stimulation -= 0.05;
  }

  return {
    scariness: clamp(scariness),
    peril: clamp(peril),
    emotional_intensity: clamp(emotionalIntensity),
    stimulation_level: clamp(stimulation),
  };
};

const deriveRecommendationSignals = (parts = {}, movie = {}, intensityScores = {}) => {
  const genreIds = new Set(Array.isArray(movie.genre_ids) ? movie.genre_ids : []);
  let cozyScore = 0.18;
  let warmth = 0.22;
  let consensusFriendliness = 0.28;
  let confusionRisk = 0.12;
  let polarizationRisk = 0.12;
  let rewatchability = 0.24;
  let sweepingEpicScore = 0.16;

  if (COZY_PATTERN.test(parts.searchableText)) {
    cozyScore += 0.34;
    warmth += 0.28;
  }

  if (GENTLE_PATTERN.test(parts.searchableText)) {
    cozyScore += 0.16;
    warmth += 0.2;
  }

  if (genreIds.has(35) || genreIds.has(10751) || genreIds.has(16)) {
    consensusFriendliness += 0.1;
    rewatchability += 0.08;
  }

  if (CONSENSUS_PATTERN.test(parts.searchableText)) {
    consensusFriendliness += 0.24;
    rewatchability += 0.14;
  }

  if (CONFUSION_PATTERN.test(parts.searchableText)) {
    confusionRisk += 0.4;
    consensusFriendliness -= 0.18;
  }

  if (POLARIZING_PATTERN.test(parts.searchableText) || intensityScores.emotional_intensity >= 0.72) {
    polarizationRisk += 0.34;
    consensusFriendliness -= 0.18;
  }

  if (HISTORICAL_SWEEP_PATTERN.test(parts.searchableText)) {
    sweepingEpicScore += 0.36;
  }

  if (ROMANTIC_SWEEP_PATTERN.test(parts.searchableText)) {
    sweepingEpicScore += 0.18;
  }

  if (PRESTIGE_DRAMA_PATTERN.test(parts.searchableText)) {
    sweepingEpicScore += 0.12;
  }

  if (genreIds.has(36) || genreIds.has(10749)) {
    sweepingEpicScore += 0.2;
  }

  if (genreIds.has(18) && Number(movie.runtime || 0) >= 120) {
    sweepingEpicScore += 0.12;
  }

  if (genreIds.has(28) || genreIds.has(878)) {
    sweepingEpicScore -= 0.12;
  }

  if (Number(movie.popularity || 0) >= 35 && Number(movie.vote_count || 0) >= 1500) {
    consensusFriendliness += 0.12;
    rewatchability += 0.08;
  }

  if (intensityScores.stimulation_level <= 0.34) {
    cozyScore += 0.12;
    consensusFriendliness += 0.06;
  }

  return {
    cozy_score: clamp(cozyScore),
    warmth_score: clamp(warmth),
    consensus_friendliness: clamp(consensusFriendliness),
    confusion_risk: clamp(confusionRisk),
    polarization_risk: clamp(polarizationRisk),
    rewatchability: clamp(rewatchability),
    sweeping_epic_score: clamp(sweepingEpicScore),
  };
};

const deriveMovieSignals = (movie = {}) => {
  const parts = getSearchableParts(movie);
  const curatedSignals = getCuratedTitleSignals(movie.title) || {};
  const audienceScores = deriveAudienceScores(movie, parts);
  const intensityScores = deriveIntensityScores(parts, movie);
  const recommendationSignals = deriveRecommendationSignals(parts, movie, intensityScores);
  const seriesMetadata = getSeriesMetadata(movie);
  const entityProminence = {};

  SUBJECT_ENTITY_RULES.forEach((rule) => {
    const prominence = getEntityProminence(parts, rule);
    if (prominence.level !== "none") {
      entityProminence[rule.key] = prominence;
    }
  });

  const animalPresence = Object.keys(entityProminence);
  const vibeTags = uniqueStrings([
    ...(GENTLE_PATTERN.test(parts.searchableText) ? ["gentle", "family", "cozy"] : []),
    ...(BRIGHT_PATTERN.test(parts.searchableText) ? ["bright"] : []),
    ...(SMART_PATTERN.test(parts.searchableText) ? ["smart"] : []),
    ...(COZY_PATTERN.test(parts.searchableText) ? ["warm", "comforting"] : []),
    ...(CONSENSUS_PATTERN.test(parts.searchableText) ? ["accessible", "consensus_friendly"] : []),
    ...(HISTORICAL_SWEEP_PATTERN.test(parts.searchableText) ? ["historical_sweep", "immersive"] : []),
    ...(ROMANTIC_SWEEP_PATTERN.test(parts.searchableText) ? ["romantic_sweep"] : []),
    ...(intensityScores.scariness >= 0.25 ? ["spooky"] : []),
    ...(intensityScores.stimulation_level <= 0.32 ? ["calm"] : intensityScores.stimulation_level >= 0.55 ? ["lively"] : []),
    ...(Array.isArray(movie.genre_names) ? movie.genre_names.map((genre) => lower(genre)) : []),
  ]);

  const audienceFitTags = uniqueStrings([
    ...(audienceScores.toddler_friendliness >= 0.74 ? ["toddler_ok", "preschool_ok"] : []),
    ...(audienceScores.kid_friendliness >= 0.68 ? ["young_kids_ok", "family_night"] : []),
    ...(intensityScores.stimulation_level <= 0.35 ? ["background_friendly", "low_stimulation"] : []),
    ...(intensityScores.peril <= 0.18 ? ["low_peril"] : []),
    ...(recommendationSignals.consensus_friendliness >= 0.64 ? ["consensus_friendly"] : []),
    ...(recommendationSignals.cozy_score >= 0.62 ? ["cozy_ok"] : []),
  ]);

  return {
    animal_presence: animalPresence,
    primary_entity_tags: Object.entries(entityProminence).filter(([, value]) => value.level === "primary").map(([key]) => key),
    secondary_entity_tags: Object.entries(entityProminence).filter(([, value]) => value.level !== "primary").map(([key]) => key),
    entity_prominence: Object.fromEntries(Object.entries(entityProminence).map(([key, value]) => [key, value.level])),
    entity_scores: Object.fromEntries(Object.entries(entityProminence).map(([key, value]) => [key, value.score])),
    kid_friendliness: clamp(audienceScores.kid_friendliness + (curatedSignals.boosts?.family || 0) / 100),
    toddler_friendliness: clamp(audienceScores.toddler_friendliness + (curatedSignals.boosts?.toddler || 0) / 100),
    scariness: intensityScores.scariness,
    peril: intensityScores.peril,
    emotional_intensity: intensityScores.emotional_intensity,
    stimulation_level: intensityScores.stimulation_level,
    cozy_score: recommendationSignals.cozy_score,
    warmth_score: recommendationSignals.warmth_score,
    consensus_friendliness: clamp(recommendationSignals.consensus_friendliness + ((curatedSignals.consensus_adult || 0) / 100)),
    confusion_risk: recommendationSignals.confusion_risk,
    polarization_risk: recommendationSignals.polarization_risk,
    rewatchability: clamp(recommendationSignals.rewatchability + (((curatedSignals.consensus_adult || 0) + (curatedSignals.cozy_adult || 0)) / 200)),
    sweeping_epic_score: clamp(recommendationSignals.sweeping_epic_score + ((curatedSignals.sweeping_epic || 0) / 100)),
    vibe_tags: vibeTags,
    audience_fit_tags: audienceFitTags,
    practical_watch_fit: uniqueStrings([
      ...(audienceFitTags.includes("family_night") ? ["family_safe"] : []),
      ...(audienceFitTags.includes("background_friendly") ? ["background_friendly"] : []),
      ...(intensityScores.stimulation_level <= 0.32 ? ["easy_group_watch"] : []),
      ...(recommendationSignals.consensus_friendliness >= 0.64 ? ["easy_group_watch", "low_regret_watch"] : []),
      ...(recommendationSignals.cozy_score >= 0.6 ? ["comfort_watch"] : []),
      ...(recommendationSignals.sweeping_epic_score >= 0.58 ? ["full_attention", "immersive_epic"] : []),
      ...(intensityScores.stimulation_level >= 0.58 ? ["full_attention"] : []),
      ...(Number(movie.runtime || 0) > 125 || intensityScores.emotional_intensity >= 0.58 ? ["patience_required"] : []),
    ]),
    series_metadata: seriesMetadata,
    curated_title_signals: curatedSignals,
  };
};

module.exports = {
  deriveMovieSignals,
};
