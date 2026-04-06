const { buildQueryExpansion } = require("./queryExpansion");

const compact = (value = "") => String(value || "").replace(/\s+/g, " ").trim();
const lower = (value = "") => compact(value).toLowerCase();
const uniqueStrings = (values = []) => [...new Set((Array.isArray(values) ? values : []).map((value) => compact(value)).filter(Boolean))];
const escapeRegex = (value = "") => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const FAMILY_DISCOVER_GENRES = [16, 10751, 35, 12, 14, 10402];
const SWEEPING_EPIC_GENRES = [18, 36, 10749, 12];
const RABBIT_DEBUG_TITLES = [
  { key: "peter_rabbit", match: (title = "") => /^peter rabbit(?!\s*2)/i.test(String(title || "").trim()) },
  { key: "peter_rabbit_2", match: (title = "") => /^peter rabbit 2/i.test(String(title || "").trim()) },
  { key: "hop", match: (title = "") => /^hop$/i.test(String(title || "").trim()) },
];
const GENERIC_MOVIE_QUERY_TERMS = new Set([
  "toddler",
  "preschool",
  "young kids",
  "family",
  "gentle",
  "bright",
  "playful",
  "simple",
  "low peril",
  "family friendly",
  "accessible",
]);

const getTextTermScore = (textValue = "", terms = []) => {
  const normalizedText = lower(textValue);

  return uniqueStrings(terms).reduce((score, term) => {
    const normalizedTerm = lower(term);

    if (!normalizedTerm) {
      return score;
    }

    if (normalizedText === normalizedTerm) {
      return score + 120;
    }

    if (new RegExp(`\\b${escapeRegex(normalizedTerm)}\\b`, "i").test(normalizedText)) {
      return score + (normalizedTerm.includes(" ") ? 34 : 18);
    }

    if (normalizedText.includes(normalizedTerm)) {
      return score + 10;
    }

    return score;
  }, 0);
};

const findExactTitleMatch = (results = [], title = "") => {
  const normalizedTitle = lower(title);
  return (Array.isArray(results) ? results : []).find((movie) => lower(movie?.title) === normalizedTitle) || null;
};

const buildRabbitPresenceMap = (movies = []) =>
  RABBIT_DEBUG_TITLES.reduce((acc, entry) => {
    const matchedMovie = (Array.isArray(movies) ? movies : []).find((movie) => entry.match(movie?.title));
    acc[entry.key] = matchedMovie
      ? {
          present: true,
          id: matchedMovie.id || null,
          title: matchedMovie.title || null,
        }
      : { present: false };
    return acc;
  }, {});

const buildRecommendationRetrievalPlan = (intent = {}) => {
  const softPreferences = Array.isArray(intent.soft_preferences)
    ? intent.soft_preferences
    : Array.isArray(intent.soft_preferences?.preference_signals)
      ? intent.soft_preferences.preference_signals
      : [];
  const historicalSweepBias = softPreferences.some((signal) => ["historical_sweep", "nature_scale", "romantic_prestige", "immersive"].includes(signal));
  const queryExpansion = intent.query_expansion || buildQueryExpansion({
    prompt: intent.raw_prompt,
    audienceAge: intent.audience_age,
    subjectEntities: intent.subject_entities,
    tonePreferences: intent.tone_preferences,
    softPreferences: intent.soft_preferences,
  });

  return {
    prompt: intent.raw_prompt || "",
    subject_entities: Array.isArray(intent.subject_entities) ? intent.subject_entities : [],
    movie_query_terms: uniqueStrings([
      ...queryExpansion.title_hints,
      ...queryExpansion.entity_aliases,
      ...queryExpansion.entity_keyword_terms,
      ...(historicalSweepBias ? ["historical romance", "frontier epic", "period drama"] : []),
    ]).filter((term) => !GENERIC_MOVIE_QUERY_TERMS.has(lower(term))).slice(0, 8),
    search_terms: uniqueStrings([
      ...queryExpansion.title_hints,
      ...queryExpansion.entity_aliases,
      ...queryExpansion.search_terms,
    ]).slice(0, 10),
    keyword_terms: uniqueStrings(queryExpansion.keyword_terms).slice(0, 10),
    title_hints: uniqueStrings(queryExpansion.title_hints).slice(0, 6),
    discover_genre_ids: uniqueStrings([
      ...(Array.isArray(intent.preferred_genre_ids) ? intent.preferred_genre_ids : []),
      ...(intent.content_safety === "very_safe" || intent.content_safety === "safe" ? FAMILY_DISCOVER_GENRES : []),
      ...(historicalSweepBias ? SWEEPING_EPIC_GENRES : []),
    ]).map((value) => Number(value)).filter(Boolean),
    family_safe_bias: intent.content_safety === "very_safe" || intent.content_safety === "safe" || Boolean(intent.guardrails?.child_family_safe),
    historical_sweep_bias: historicalSweepBias,
    keyword_only_mode: Boolean(intent.subject_entities?.length),
  };
};

const buildRecommendationStructuredScore = (movie = {}, plan = {}, matchReasons = []) => {
  const searchableText = [movie.title, movie.overview, movie.tagline, ...matchReasons].filter(Boolean).join(" ");
  let score = 0;
  const genreIds = Array.isArray(movie.genre_ids) ? movie.genre_ids : [];

  const titleHintScore = getTextTermScore(movie.title, plan.title_hints || []);
  const subjectScore = getTextTermScore(searchableText, plan.keyword_terms || []);
  const searchTermScore = getTextTermScore(searchableText, plan.search_terms || []);

  score += titleHintScore * 1.3;
  score += subjectScore;
  score += Math.round(searchTermScore * 0.45);
  score += Math.min(Number(movie.popularity || 0), 120) / 5;
  score += Math.min(Number(movie.vote_count || 0), 400) / 20;

  if (plan.family_safe_bias) {
    if (genreIds.some((genreId) => FAMILY_DISCOVER_GENRES.includes(genreId))) {
      score += 18;
    } else {
      score -= 26;
    }
  }

  return Math.round(score);
};

const resolveExpandedRecommendationCandidates = async ({
  intent = {},
  fetchTmdb,
  fetchStructuredMoviesByIds,
  normalizeStructuredCandidate,
  debugCollector = null,
} = {}) => {
  const plan = buildRecommendationRetrievalPlan(intent);
  const candidateMap = new Map();

  const rememberCandidate = (movie = {}, metadata = {}) => {
    if (!movie?.id) {
      return;
    }

    const existing = candidateMap.get(movie.id) || normalizeStructuredCandidate(movie, {
      source_type: "semantic_prompt_search",
      source_endpoint: metadata.source_endpoint || "/search/movie",
    });
    candidateMap.set(
      movie.id,
      normalizeStructuredCandidate(
        {
          ...existing,
          structured_match_reasons: uniqueStrings([
            ...(existing.structured_match_reasons || []),
            ...(metadata.match_reasons || []),
          ]),
        },
        {
          source_type: "semantic_prompt_search",
          source_endpoint: metadata.source_endpoint || existing.source_endpoint || "/search/movie",
        }
      )
    );
  };

  const noteStage = (label, movies = []) => {
    if (typeof debugCollector !== "function") {
      return;
    }

    debugCollector({
      label,
      total: Array.isArray(movies) ? movies.length : 0,
      sample_titles: (Array.isArray(movies) ? movies : []).slice(0, 12).map((movie) => movie?.title).filter(Boolean),
      rabbit_presence: buildRabbitPresenceMap(movies),
    });
  };

  for (const term of plan.movie_query_terms) {
    try {
      const payload = await fetchTmdb("/search/movie", { query: term, include_adult: "false", page: 1 });
      noteStage(`search_movie:${term}`, payload.results || []);
      (payload.results || []).slice(0, 10).forEach((movie) => {
        rememberCandidate(movie, {
          source_endpoint: "/search/movie",
          match_reasons: [`Expanded prompt search matched "${term}".`],
        });
      });
    } catch (error) {
      console.error("Error fetching expanded recommendation search candidates:", error.response?.data || error.message);
    }
  }

  for (const hint of plan.title_hints || []) {
    try {
      const payload = await fetchTmdb("/search/movie", { query: hint, include_adult: "false", page: 1 });
      noteStage(`exact_title_hint_search:${hint}`, payload.results || []);
      const exactMatch = findExactTitleMatch(payload.results || [], hint);
      if (exactMatch) {
        rememberCandidate(exactMatch, {
          source_endpoint: "/search/movie",
          match_reasons: [`Exact title hint matched "${hint}".`],
        });
      }
    } catch (error) {
      console.error("Error fetching exact title-hint recommendation candidates:", error.response?.data || error.message);
    }
  }

  for (const term of plan.keyword_terms) {
    try {
      const payload = await fetchTmdb("/search/keyword", { query: term, page: 1 });
      for (const keyword of (payload.results || []).slice(0, 4)) {
        if (!keyword?.id) {
          continue;
        }

        const discoverParams = {
          with_keywords: keyword.id,
          sort_by: "popularity.desc",
          include_adult: "false",
          page: 1,
        };

        if (plan.family_safe_bias) {
          discoverParams.with_genres = FAMILY_DISCOVER_GENRES.join(",");
          discoverParams.certification_country = "US";
          discoverParams["certification.lte"] = "PG";
        }

        const discoverPayload = await fetchTmdb("/discover/movie", discoverParams);
        noteStage(`discover_keyword:${keyword.name}`, discoverPayload.results || []);
        (discoverPayload.results || []).slice(0, 12).forEach((movie) => {
          rememberCandidate(movie, {
            source_endpoint: "/discover/movie",
            match_reasons: [`TMDB keyword matched "${keyword.name}".`],
          });
        });
      }
    } catch (error) {
      console.error("Error fetching expanded recommendation keyword candidates:", error.response?.data || error.message);
    }
  }

  if (plan.family_safe_bias) {
    try {
      const payload = await fetchTmdb("/discover/movie", {
        with_genres: FAMILY_DISCOVER_GENRES.join(","),
        certification_country: "US",
        "certification.lte": "PG",
        sort_by: "popularity.desc",
        include_adult: "false",
        page: 1,
      });
      noteStage("family_safe_discover", payload.results || []);
      (payload.results || []).slice(0, 18).forEach((movie) => {
        rememberCandidate(movie, {
          source_endpoint: "/discover/movie",
          match_reasons: ["Family-safe discover pool matched the request context."],
        });
      });
    } catch (error) {
      console.error("Error fetching family-safe recommendation candidates:", error.response?.data || error.message);
    }
  }

  if (plan.historical_sweep_bias) {
    try {
      const payload = await fetchTmdb("/discover/movie", {
        with_genres: SWEEPING_EPIC_GENRES.join(","),
        sort_by: "vote_average.desc",
        "vote_count.gte": 150,
        include_adult: "false",
        page: 1,
      });
      noteStage("historical_sweep_discover", payload.results || []);
      (payload.results || []).slice(0, 18).forEach((movie) => {
        rememberCandidate(movie, {
          source_endpoint: "/discover/movie",
          match_reasons: ["Historical-sweep discover pool matched the request context."],
        });
      });
    } catch (error) {
      console.error("Error fetching historical-sweep recommendation candidates:", error.response?.data || error.message);
    }
  }

  const detailedCandidates = await fetchStructuredMoviesByIds(Array.from(candidateMap.keys()), {
    source_type: "semantic_prompt_search",
    source_endpoint: "/discover/movie",
  });
  noteStage("semantic_detailed_candidates", detailedCandidates);

  return detailedCandidates
    .map((movie) => {
      const merged = normalizeStructuredCandidate({
        ...movie,
        structured_match_reasons: uniqueStrings([
          ...(movie.structured_match_reasons || []),
          ...((candidateMap.get(movie.id)?.structured_match_reasons) || []),
        ]),
      });
      return normalizeStructuredCandidate(merged, {
        structured_match_score: buildRecommendationStructuredScore(merged, plan, merged.structured_match_reasons || []),
        structured_match_reasons: merged.structured_match_reasons,
      });
    })
    .filter((movie) => movie.structured_match_score >= (plan.keyword_only_mode ? 24 : 18))
    .sort((left, right) => right.structured_match_score - left.structured_match_score)
    .slice(0, 40);
};

module.exports = {
  buildRecommendationRetrievalPlan,
  resolveExpandedRecommendationCandidates,
};
