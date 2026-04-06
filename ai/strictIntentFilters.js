const compact = (value = "") => String(value || "").replace(/\s+/g, " ").trim();
const lower = (value = "") => compact(value).toLowerCase();
const uniqueStrings = (values = []) => [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
const matchesAnyGenre = (genreIds = [], expectedIds = []) =>
  expectedIds.some((genreId) => Array.isArray(genreIds) && genreIds.includes(genreId));

const TODDLER_SUPPORTIVE_GENRE_IDS = [16, 10751, 35, 12, 14, 10402];
const TODDLER_BLOCKED_GENRE_IDS = [27, 53, 80, 10752];
const TODDLER_BLOCKED_TEXT_PATTERN =
  /\bhorror|slasher|serial killer|killer|murder|violent|violence|blood|gore|war|battlefield|combat|assassin|revenge|crime boss|gangster|drug cartel|abuse|trauma|suicide|kidnap|hostage|terror|distressing|bleak|grief|mourning|terminal illness|adult themes|sexual|erotic|affair|addiction|prison|post-apocalyptic|post apocalyptic|apocalypse|apocalyptic|end of the world|disaster|catastrophe|pandemic outbreak|zombie\b/i;

const getAudienceBucket = (audiencePrimary = "") => {
  if (audiencePrimary === "young_child") {
    return "toddler";
  }

  if (audiencePrimary === "child") {
    return "kids";
  }

  if (audiencePrimary === "family") {
    return "family";
  }

  return "general";
};

const buildStrictIntentFilters = ({
  prompt = "",
  audience = {},
  guardrails = {},
  tone = [],
  thematicTerms = [],
  structuredQuery = null,
  avoidanceSignals = [],
} = {}) => {
  const audienceBucket = getAudienceBucket(audience?.primary);
  const childSafe = Boolean(guardrails?.child_family_safe);
  const structuredThemes = Array.isArray(structuredQuery?.themes) ? structuredQuery.themes : [];
  const baseThemeTerms = uniqueStrings(
    structuredThemes.length
      ? structuredThemes.flatMap((theme) => theme.keyword_terms || [])
      : thematicTerms
  );
  const expandedThemeTerms = uniqueStrings([
    ...baseThemeTerms,
    ...thematicTerms,
    ...structuredThemes.flatMap((theme) => theme.expanded_keyword_terms || []),
  ]);

  return {
    audience: audienceBucket,
    tone: uniqueStrings([
      ...tone,
      ...(childSafe ? ["gentle", "safe"] : []),
    ]),
    rating_allowlist: childSafe ? ["G", "PG"] : [],
    theme_terms: baseThemeTerms,
    expanded_theme_terms: expandedThemeTerms,
    require_theme_match: Boolean(baseThemeTerms.length),
    exclude_terms: uniqueStrings([
      ...avoidanceSignals,
      ...(childSafe ? ["violence", "intense", "dark", "distress", "adult themes"] : []),
    ]),
    blocked_genre_ids: childSafe
      ? Array.from(new Set([...(guardrails?.hard_exclude_genre_ids || []), ...TODDLER_BLOCKED_GENRE_IDS]))
      : [],
    supportive_genre_ids: childSafe
      ? Array.from(new Set([...(guardrails?.supportive_genre_ids || []), ...TODDLER_SUPPORTIVE_GENRE_IDS]))
      : [],
    child_safe_only: childSafe,
    hard_block_categories: childSafe
      ? ["r_rated", "post_apocalyptic", "war", "horror", "disaster"]
      : [],
  };
};

const hasStrictIntentFilters = (intent = {}) => {
  const strictFilters = intent?.strict_filters || {};
  return Boolean(
    strictFilters.child_safe_only
      || (Array.isArray(strictFilters.theme_terms) && strictFilters.theme_terms.length)
      || (Array.isArray(strictFilters.blocked_genre_ids) && strictFilters.blocked_genre_ids.length)
      || (Array.isArray(strictFilters.rating_allowlist) && strictFilters.rating_allowlist.length)
  );
};

const getMovieThemeMatchScore = (movie = {}, strictFilters = {}, options = {}) => {
  const themeTerms = options.allowExpandedThemes
    ? strictFilters.expanded_theme_terms || strictFilters.theme_terms || []
    : strictFilters.theme_terms || [];
  const searchableText = lower([
    movie.title,
    movie.overview,
    movie.tagline,
    ...(Array.isArray(movie.structured_match_reasons) ? movie.structured_match_reasons : []),
  ].filter(Boolean).join(" "));

  return uniqueStrings(themeTerms).reduce((score, term) => {
    const normalizedTerm = lower(term);

    if (!normalizedTerm) {
      return score;
    }

    if (searchableText.includes(normalizedTerm)) {
      return score + (normalizedTerm.includes(" ") ? 2 : 1);
    }

    return score;
  }, 0);
};

const passesStrictIntentFilter = (movie = {}, intent = {}, options = {}) => {
  const strictFilters = intent?.strict_filters || {};

  if (!hasStrictIntentFilters(intent)) {
    return true;
  }

  const genreIds = Array.isArray(movie.genre_ids) ? movie.genre_ids : [];
  const searchableText = lower([movie.title, movie.overview, movie.tagline].filter(Boolean).join(" "));
  const certification = String(movie.us_certification || "").trim().toUpperCase();
  const supportiveGenreMatch = matchesAnyGenre(genreIds, strictFilters.supportive_genre_ids || []);

  if (strictFilters.child_safe_only) {
    if (movie.adult) {
      return false;
    }

    if (certification && Array.isArray(strictFilters.rating_allowlist) && strictFilters.rating_allowlist.length && !strictFilters.rating_allowlist.includes(certification)) {
      return false;
    }

    if (matchesAnyGenre(genreIds, strictFilters.blocked_genre_ids || [])) {
      return false;
    }

    if (TODDLER_BLOCKED_TEXT_PATTERN.test(searchableText)) {
      return false;
    }

    if ((strictFilters.audience === "toddler" || strictFilters.audience === "kids") && matchesAnyGenre(genreIds, [28, 18]) && !supportiveGenreMatch) {
      return false;
    }
  }

  if (strictFilters.require_theme_match) {
    if (!getMovieThemeMatchScore(movie, strictFilters, options)) {
      return false;
    }
  }

  if (strictFilters.child_safe_only && (strictFilters.audience === "toddler" || strictFilters.audience === "kids") && !supportiveGenreMatch) {
    return false;
  }

  return true;
};

module.exports = {
  buildStrictIntentFilters,
  hasStrictIntentFilters,
  getMovieThemeMatchScore,
  passesStrictIntentFilter,
};
