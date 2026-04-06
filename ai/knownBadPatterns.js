const { getCuratedTitleSignals } = require("./curatedRecommendationSignals");

const normalizeText = (value = "") => String(value || "").toLowerCase();

const matchesAnyGenre = (genreIds = [], expectedIds = []) =>
  expectedIds.some((genreId) => Array.isArray(genreIds) && genreIds.includes(genreId));

const EASY_WATCH_SUPPORTIVE_GENRE_IDS = [35, 12, 16, 10749, 10751, 14, 10402];
const EASY_WATCH_BLOCKED_GENRE_IDS = [27, 53, 80, 10752];
const LOW_STRESS_BLOCKED_TEXT_PATTERN =
  /\bhorror|slasher|serial killer|killer|murder|violent|violence|blood|gore|war|battlefield|combat|assassin|revenge|drug cartel|abuse|trauma|suicide|kidnap|hostage|terror|bleak|grief|mourning|terminal illness|adult themes|sexual|erotic|affair|addiction|prison|post-apocalyptic|post apocalyptic|apocalypse|apocalyptic|end of the world|disaster|catastrophe|pandemic outbreak|zombie\b/i;

const isProtectedCanonicalFamilyEntry = (movie = {}, genreIds = []) => {
  const curatedSignals = getCuratedTitleSignals(movie.title) || {};
  return Boolean(curatedSignals.canonical_family_entry) && matchesAnyGenre(genreIds, EASY_WATCH_SUPPORTIVE_GENRE_IDS);
};

const getKnownBadPatternAdjustments = (movie = {}, intent = {}) => {
  const genreIds = Array.isArray(movie.genre_ids) ? movie.genre_ids : [];
  const runtime = Number(movie.runtime || 0);
  const searchableText = [movie.title, movie.overview, movie.tagline].filter(Boolean).join(" ");
  const loweredText = normalizeText(searchableText);
  const protectedCanonicalFamilyEntry = isProtectedCanonicalFamilyEntry(movie, genreIds);
  const reasons = [];
  let scoreAdjustment = 0;
  let hardReject = false;

  if (intent.guardrails?.child_family_safe) {
    if (matchesAnyGenre(genreIds, EASY_WATCH_BLOCKED_GENRE_IDS) || (LOW_STRESS_BLOCKED_TEXT_PATTERN.test(searchableText) && !protectedCanonicalFamilyEntry)) {
      hardReject = true;
      reasons.push("family_safety_guardrail");
    }
  }

  const wantsEasyWatch =
    intent.rubric_keys?.includes("easy_watch") ||
    intent.emotional_tolerance?.low_stress ||
    intent.attention_profile?.level === "background" ||
    intent.attention_profile?.level === "easy";

  if (wantsEasyWatch) {
    const supportiveGenreMatch = matchesAnyGenre(genreIds, EASY_WATCH_SUPPORTIVE_GENRE_IDS);
    const blockedGenreMatch = matchesAnyGenre(genreIds, EASY_WATCH_BLOCKED_GENRE_IDS);

    if (supportiveGenreMatch) {
      scoreAdjustment += 18;
      reasons.push("easy_watch_supportive_genres");
    }

    if (blockedGenreMatch) {
      scoreAdjustment -= 28;
      reasons.push("easy_watch_intense_genres");
    }

    if (LOW_STRESS_BLOCKED_TEXT_PATTERN.test(searchableText) && !protectedCanonicalFamilyEntry) {
      scoreAdjustment -= 24;
      reasons.push("easy_watch_distressing_text");
    }

    if (runtime && runtime <= 110) {
      scoreAdjustment += 8;
      reasons.push("easy_watch_manageable_runtime");
    }

    if (runtime && runtime > 145) {
      scoreAdjustment -= 12;
      reasons.push("easy_watch_overlong_runtime");
    }

    if (runtime && runtime <= 105 && !supportiveGenreMatch && !blockedGenreMatch) {
      scoreAdjustment -= 10;
      reasons.push("easy_watch_runtime_only");
    }
  }

  if (intent.query_type === "COUNTRY") {
    const country = intent.structured_query?.country || {};
    const aliases = [country.display_name, ...(country.aliases || []), ...(country.location_terms || [])]
      .filter(Boolean)
      .map((entry) => normalizeText(entry));
    const hasProductionMatch = Array.isArray(movie.production_country_codes) && movie.production_country_codes.includes(country.iso_3166_1);
    const hasLanguageMatch = Array.isArray(movie.spoken_language_codes)
      && Array.isArray(country.language_codes)
      && movie.spoken_language_codes.some((code) => country.language_codes.includes(code));
    const hasTextMatch = aliases.some((term) => term && loweredText.includes(term));

    if (hasProductionMatch || hasLanguageMatch || hasTextMatch) {
      scoreAdjustment += 20;
      reasons.push("country_relevance_confirmed");
    } else {
      scoreAdjustment -= 26;
      reasons.push("country_relevance_weak");
    }
  }

  if (intent.query_type === "AWARDS") {
    if (Number(movie.structured_match_score || 0) > 0) {
      scoreAdjustment += 24;
      reasons.push("awards_match_confirmed");
    } else {
      scoreAdjustment -= 42;
      reasons.push("awards_match_missing");
    }
  }

  return {
    hardReject,
    scoreAdjustment,
    reasons,
  };
};

const summarizeAppliedConstraints = (intent = {}, refinement = null) => {
  const applied = [];

  if (intent.guardrails?.child_family_safe) {
    applied.push("child_family_safe");
  }

  if (intent.hard_filters?.max_runtime_minutes) {
    applied.push(`max_runtime_${intent.hard_filters.max_runtime_minutes}`);
  }

  if (intent.hard_filters?.min_runtime_minutes) {
    applied.push(`min_runtime_${intent.hard_filters.min_runtime_minutes}`);
  }

  if (intent.query_type === "COUNTRY" && intent.structured_query?.country?.canonical) {
    applied.push(`country_${intent.structured_query.country.canonical}`);
  }

  if (intent.query_type === "AWARDS" && intent.structured_query?.year) {
    applied.push(`awards_${intent.structured_query.year}`);
  }

  if (refinement?.id) {
    applied.push(`refine_${refinement.id}`);
  }

  return applied;
};

module.exports = {
  getKnownBadPatternAdjustments,
  summarizeAppliedConstraints,
};
