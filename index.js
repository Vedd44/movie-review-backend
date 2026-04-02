require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { parseReelbotIntent, isIntentSnapshotValid } = require("./ai/intentParser");
const { hasChildFamilyGuardrails, passesAudienceGuardrails, getAudienceContextFitScore } = require("./ai/audienceSignals");
const { detectStructuredQuery } = require("./ai/queryInterpreter");
const { getKnownBadPatternAdjustments, summarizeAppliedConstraints } = require("./ai/knownBadPatterns");
const { buildPickRankerPrompts, buildPickWriterPrompts } = require("./ai/promptBuilders/homepagePick");
const { buildDetailPrompts } = require("./ai/promptBuilders/detailPage");
const { pickRankingSchema, pickWriterSchema, getDetailSchema } = require("./ai/aiSchemas");
const { REELBOT_BANNED_PHRASES } = require("./ai/reelbotPrinciples");

const app = express();
const PORT = process.env.PORT || 5001;
const AI_NAME = "ReelBot";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const TMDB_API_KEY = process.env.TMDB_API_KEY?.trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || "gpt-5-mini").trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const reelbotCache = new Map();
const pickCache = new Map();
const tmdbCache = new Map();
const pickSurfaceTally = new Map();
const promptLookupCache = new Map();
const sitemapMovieIndex = new Map();

const CACHE_TTLS = {
  now_playing: 5 * 60 * 1000,
  popular: 10 * 60 * 1000,
  upcoming: 30 * 60 * 1000,
  discover: 10 * 60 * 1000,
  pick: 3 * 60 * 1000,
  movie_details: 6 * 60 * 60 * 1000,
  prompt_lookup: 6 * 60 * 60 * 1000,
};

const FEED_PAGE_ROTATION_LIMITS = {
  now_playing: 3,
  popular: 5,
  upcoming: 4,
  discover: 6,
};

const HOMEPAGE_MIN_FEED_RESULTS = {
  now_playing: 8,
  popular: 8,
  upcoming: 8,
};

const HOMEPAGE_FILL_LOOKAHEAD = {
  now_playing: 2,
  popular: 2,
  upcoming: 4,
};

const OVEREXPOSED_PICK_TITLES = new Set([
  "the shawshank redemption",
  "the godfather",
  "the dark knight",
  "pulp fiction",
  "fight club",
  "forrest gump",
  "goodfellas",
  "interstellar",
  "inception",
  "the lord of the rings: the return of the king",
]);

const REELBOT_ACTIONS = {
  quick_take: {
    label: "Quick Take",
    maxTokens: 280,
  },
  is_this_for_me: {
    label: "Is This For Me?",
    maxTokens: 320,
  },
  why_watch: {
    label: "Why Watch It",
    maxTokens: 380,
  },
  best_if_you_want: {
    label: "Best If You Want",
    maxTokens: 220,
  },
  spoiler_synopsis: {
    label: "Spoiler Synopsis",
    maxTokens: 550,
  },
  similar_picks: {
    label: "Similar Picks",
    maxTokens: 360,
  },
  scary_check: {
    label: "Is It Scary?",
    maxTokens: 180,
  },
  pace_check: {
    label: "Is It Slow?",
    maxTokens: 180,
  },
  best_mood: {
    label: "Best Mood For This",
    maxTokens: 220,
  },
  date_night: {
    label: "Good Date-Night Watch?",
    maxTokens: 220,
  },
  ending_explained: {
    label: "Ending Explained",
    maxTokens: 320,
  },
  themes_and_takeaways: {
    label: "Themes & Takeaways",
    maxTokens: 300,
  },
  debate_club: {
    label: "What People Debate",
    maxTokens: 260,
  },
};

const SPOILER_ACTION_IDS = new Set(["spoiler_synopsis", "ending_explained", "themes_and_takeaways", "debate_club"]);

const VALID_DISCOVERY_VIEWS = new Set(["latest", "now_playing", "popular", "upcoming"]);

const PICK_MOOD_CONFIG = {
  all: {
    label: "Any mood",
    genreIds: [],
  },
  easy_watch: {
    label: "Easy Watch",
    genreIds: [35, 10751, 16, 10749, 12],
  },
  mind_bending: {
    label: "Smart / Twisty",
    genreIds: [878, 9648, 53],
  },
  dark: {
    label: "Dark",
    genreIds: [27, 53, 80],
  },
  funny: {
    label: "Funny",
    genreIds: [35],
  },
  feel_something: {
    label: "Emotional",
    genreIds: [18, 10749, 10402, 16],
  },
};

const PICK_RUNTIME_CONFIG = {
  any: {
    label: "Any length",
  },
  under_two_hours: {
    label: "Under 2 hours",
    max: 120,
  },
  over_two_hours: {
    label: "2+ hours",
    min: 121,
  },
};

const PICK_COMPANY_CONFIG = {
  any: {
    label: "Any setup",
    genreIds: [],
  },
  solo: {
    label: "Solo watch",
    genreIds: [18, 9648, 878, 53, 36, 99],
  },
  pair: {
    label: "Date night",
    genreIds: [10749, 35, 18, 10402],
  },
  friends: {
    label: "With friends",
    genreIds: [28, 12, 27, 35, 878],
  },
};

const TMDB_MOVIE_GENRE_LOOKUP = {
  12: "Adventure",
  14: "Fantasy",
  16: "Animation",
  18: "Drama",
  27: "Horror",
  28: "Action",
  35: "Comedy",
  36: "History",
  37: "Western",
  53: "Thriller",
  80: "Crime",
  878: "Sci-Fi",
  9648: "Mystery",
  99: "Documentary",
  10402: "Music",
  10749: "Romance",
  10751: "Family",
  10752: "War",
};


const PROMPT_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "best",
  "but",
  "for",
  "fun",
  "good",
  "i",
  "if",
  "in",
  "into",
  "it",
  "like",
  "me",
  "movie",
  "movies",
  "my",
  "night",
  "non",
  "of",
  "or",
  "something",
  "that",
  "the",
  "this",
  "to",
  "watch",
  "with",
]);

const SIGNAL_SCORE_THRESHOLD = 10;
const SITE_ORIGIN = (process.env.SITE_ORIGIN || process.env.REACT_APP_SITE_URL || "https://reelbot.movie").trim().replace(/\/$/, "");

const slugifyMovieTitle = (title = "movie") =>
  String(title || "movie")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "movie";

const buildMovieCanonicalPath = (movie = {}) => `/movies/${movie.id}/${slugifyMovieTitle(movie.title)}`;

const escapeXml = (value = "") => String(value || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

const rememberMovieForSitemap = (movie = {}) => {
  if (!movie?.id || !movie?.title) {
    return;
  }

  sitemapMovieIndex.set(movie.id, {
    id: movie.id,
    title: movie.title,
    release_date: movie.release_date || "",
    updated_at: new Date().toISOString(),
  });
};

console.log(`OpenAI model configured: ${OPENAI_MODEL}`);
console.log(`OpenAI API key present: ${OPENAI_API_KEY ? "yes" : "no"}`);
console.log(`TMDB API key present: ${TMDB_API_KEY ? "yes" : "no"}`);

app.use(cors());
app.use(express.json());

const fetchSupabaseUser = async (accessToken = "") => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !accessToken) {
    return null;
  }

  const response = await axios.get(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return response.data || null;
};

const deleteSupabaseUser = async (userId) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !userId) {
    return;
  }

  await axios.delete(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
};

const fetchTmdb = async (path, params = {}) => {
  const searchParams = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: "en-US",
    ...params,
  });

  const response = await axios.get(`https://api.themoviedb.org/3${path}?${searchParams.toString()}`);
  return response.data;
};

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const readCache = (cache, key) => {
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value;
};

const writeCache = (cache, key, value, ttlMs) => {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });

  return value;
};

const fetchTmdbCached = async (path, params = {}, ttlMs = CACHE_TTLS.discover) => {
  const cacheKey = `${path}:${stableStringify(params)}`;
  const cachedValue = readCache(tmdbCache, cacheKey);

  if (cachedValue) {
    return cachedValue;
  }

  const payload = await fetchTmdb(path, params);
  return writeCache(tmdbCache, cacheKey, payload, ttlMs);
};

const getFeedCacheTtl = (type) => {
  switch (normalizeDiscoveryView(type)) {
    case "popular":
      return CACHE_TTLS.popular;
    case "upcoming":
      return CACHE_TTLS.upcoming;
    case "now_playing":
    default:
      return CACHE_TTLS.now_playing;
  }
};

const getRotatedPage = (type, offset = 0) => {
  const normalizedType = type === "discover" ? "discover" : normalizeDiscoveryView(type);
  const pageLimit = FEED_PAGE_ROTATION_LIMITS[normalizedType] || 1;
  const bucketSize = normalizedType === "discover" ? CACHE_TTLS.discover : getFeedCacheTtl(normalizedType);
  const bucket = Math.floor(Date.now() / bucketSize);
  const seedSource = `${normalizedType}:${bucket}:${offset}`;
  const seed = Array.from(seedSource).reduce((total, character) => total + character.charCodeAt(0), 0);
  return (seed % pageLimit) + 1;
};

const buildFeedCacheControlHeader = (type) => {
  const ttlSeconds = Math.floor(getFeedCacheTtl(type) / 1000);
  return `public, s-maxage=${ttlSeconds}, stale-while-revalidate=60`;
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const truncateText = (value = "", maxLength = 280) => {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trim()}…`;
};

const normalizeRichText = (content) => {
  const text = String(content || "").trim();

  if (!text) {
    return "";
  }

  if (/<\s*(p|ul|ol|li|strong|em|br)\b/i.test(text)) {
    return text;
  }

  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("");
};

const getDirector = (credits) => {
  const director = credits?.crew?.find((crewMember) => crewMember.job === "Director");
  return director?.name || "Unknown";
};

const isUpcomingMovie = (movie) => {
  const releaseDate = movie?.release_date ? new Date(movie.release_date) : null;
  const hasFutureRelease = releaseDate instanceof Date && !Number.isNaN(releaseDate.getTime()) && releaseDate > new Date();
  return (movie?.status && movie.status !== "Released") || hasFutureRelease;
};

const getReviewRating = (review) => {
  const rawRating = review?.author_details?.rating;
  if (rawRating === null || rawRating === undefined || rawRating === "") {
    return null;
  }

  const parsedRating = Number(rawRating);
  return Number.isFinite(parsedRating) ? parsedRating : null;
};

const normalizeReviewHighlight = (review, sourceLabel) => {
  if (!review?.content) {
    return null;
  }

  const rating = getReviewRating(review);

  return {
    author: review.author || "TMDB reviewer",
    source: sourceLabel,
    rating,
    content: truncateText(review.content, 420),
    url: review.url || "",
    updated_at: review.updated_at || review.created_at || "",
  };
};

const getReviewHighlights = (reviews = []) => {
  const validReviews = Array.isArray(reviews) ? reviews.filter((review) => review?.content) : [];

  if (!validReviews.length) {
    return {
      positive: null,
      negative: null,
      count: 0,
      source: "TMDB user reviews",
    };
  }

  const ratedReviews = validReviews.filter((review) => getReviewRating(review) !== null);
  const source = "TMDB user reviews";

  if (ratedReviews.length >= 2) {
    const sortedByRating = [...ratedReviews].sort((left, right) => getReviewRating(right) - getReviewRating(left));
    const positiveReview = sortedByRating[0];
    const negativeReview = [...sortedByRating].reverse().find((review) => review.url !== positiveReview.url) || sortedByRating[sortedByRating.length - 1];

    return {
      positive: normalizeReviewHighlight(positiveReview, source),
      negative: normalizeReviewHighlight(negativeReview, source),
      count: validReviews.length,
      source,
    };
  }

  const positiveReview = validReviews[0];
  const negativeReview = validReviews.length > 1 ? validReviews[validReviews.length - 1] : null;

  return {
    positive: normalizeReviewHighlight(positiveReview, source),
    negative: normalizeReviewHighlight(negativeReview, source),
    count: validReviews.length,
    source,
  };
};

const normalizeDiscoveryView = (view) => {
  if (view === "latest") {
    return "now_playing";
  }

  return VALID_DISCOVERY_VIEWS.has(view) ? view : "now_playing";
};

const VALID_PICK_SOURCES = new Set(["feed", "library"]);

const normalizePreferenceKey = (value, config, fallback) => (config[value] ? value : fallback);
const normalizePickSource = (value) => (VALID_PICK_SOURCES.has(value) ? value : "feed");

const normalizePickGenre = (value) => {
  if (!value || value === "all") {
    return "all";
  }

  const genreIds = String(value)
    .split(",")
    .map((entry) => Number.parseInt(entry, 10))
    .filter((genreId) => TMDB_MOVIE_GENRE_LOOKUP[genreId]);

  return genreIds.length ? genreIds.join(",") : "all";
};

const getGenreFilterIds = (value) =>
  normalizePickGenre(value) === "all"
    ? []
    : normalizePickGenre(value)
        .split(",")
        .map((entry) => Number.parseInt(entry, 10))
        .filter(Boolean);

const tokenizePrompt = (prompt = "") =>
  String(prompt || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);

const normalizeSearchText = (value = "") =>
  String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenizeSearchText = (value = "") => normalizeSearchText(value).split(" ").filter(Boolean);

const getSearchTitleMatchScore = (query = "", title = "") => {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(title);

  if (!normalizedQuery || !normalizedTitle) {
    return 0;
  }

  if (normalizedQuery === normalizedTitle) {
    return 100;
  }

  if (normalizedTitle.startsWith(normalizedQuery)) {
    return 72;
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return 48;
  }

  const queryTokens = tokenizeSearchText(query);
  const titleTokens = tokenizeSearchText(title);
  const overlapCount = queryTokens.filter((token) => titleTokens.includes(token)).length;

  if (!overlapCount) {
    return 0;
  }

  return (overlapCount / Math.max(queryTokens.length, titleTokens.length)) * 42;
};

const getPromptSearchQueries = (prompt = "") => {
  const rawTokens = tokenizePrompt(prompt);
  const rankedTokens = rawTokens.filter((token) => !PROMPT_STOPWORDS.has(token));
  const tokens = rankedTokens.length ? rankedTokens : rawTokens;
  const queries = [];

  if (tokens.length >= 3) {
    for (let index = 0; index <= tokens.length - 3; index += 1) {
      queries.push(tokens.slice(index, index + 3).join(" "));
    }
  }

  if (tokens.length >= 2) {
    for (let index = 0; index <= tokens.length - 2; index += 1) {
      queries.push(tokens.slice(index, index + 2).join(" "));
    }
  }

  if (tokens.length) {
    queries.push(tokens.slice(0, 4).join(" "));
  }

  queries.push(String(prompt || "").trim().toLowerCase());

  return [...new Set(queries.map((query) => query.trim()).filter((query) => query.split(/\s+/).length >= 2))].slice(0, 6);
};

const countPromptMatches = (textValue = "", promptTokens = []) => {
  const haystack = String(textValue || "").toLowerCase();
  return promptTokens.reduce((count, token) => (haystack.includes(token) ? count + 1 : count), 0);
};

const escapeRegex = (value = "") => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const decodeHtmlEntities = (value = "") =>
  String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const htmlToTextLines = (html = "") =>
  decodeHtmlEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

const uniqueStrings = (values = []) => [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];

const uniqueMoviesById = (movies = []) => {
  const seen = new Set();
  return (Array.isArray(movies) ? movies : []).filter((movie) => {
    if (!movie?.id || seen.has(movie.id)) {
      return false;
    }
    seen.add(movie.id);
    return true;
  });
};

const sanitizeAwardTitle = (value = "") =>
  String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .trim();

const mergeGenreIds = (...collections) =>
  Array.from(
    new Set(
      collections
        .flat()
        .map((entry) => Number.parseInt(entry, 10))
        .filter(Boolean)
    )
  );

const getTextTermScore = (textValue = "", terms = []) => {
  const normalizedText = normalizeSearchText(textValue);
  if (!normalizedText) {
    return 0;
  }

  return uniqueStrings(terms).reduce((score, term) => {
    const normalizedTerm = normalizeSearchText(term);
    if (!normalizedTerm) {
      return score;
    }

    if (normalizedText === normalizedTerm) {
      return score + 80;
    }

    if (new RegExp(`\\b${escapeRegex(normalizedTerm)}\\b`, "i").test(normalizedText)) {
      return score + 40;
    }

    if (normalizedText.includes(normalizedTerm)) {
      return score + 18;
    }

    return score;
  }, 0);
};

const normalizeStructuredCandidate = (movie = {}, overrides = {}) => ({
  ...movie,
  genre_ids: Array.isArray(movie.genre_ids)
    ? movie.genre_ids
    : Array.isArray(movie.genres)
      ? movie.genres.map((genre) => genre.id)
      : [],
  genre_names: Array.isArray(movie.genre_names)
    ? movie.genre_names
    : Array.isArray(movie.genres)
      ? movie.genres.map((genre) => genre.name)
      : [],
  production_countries: Array.isArray(movie.production_countries)
    ? movie.production_countries.map((entry) => (typeof entry === "string" ? entry : entry?.name)).filter(Boolean)
    : [],
  production_country_codes: Array.isArray(movie.production_countries)
    ? movie.production_countries.map((entry) => (typeof entry === "string" ? null : entry?.iso_3166_1)).filter(Boolean)
    : Array.isArray(movie.production_country_codes)
      ? movie.production_country_codes
      : [],
  spoken_language_codes: Array.isArray(movie.spoken_languages)
    ? movie.spoken_languages.map((entry) => entry?.iso_639_1).filter(Boolean)
    : Array.isArray(movie.spoken_language_codes)
      ? movie.spoken_language_codes
      : [],
  structured_match_score: overrides.structured_match_score || movie.structured_match_score || 0,
  structured_match_reasons: uniqueStrings(overrides.structured_match_reasons || movie.structured_match_reasons || []),
  source_type: overrides.source_type || movie.source_type || "structured_search",
  source_endpoint: overrides.source_endpoint || movie.source_endpoint || "/discover/movie",
});

const PERSON_WITH_PATTERNS = [
  /(?:movies|films)\s+with\s+(.+)/i,
  /starring\s+(.+)/i,
  /with\s+(.+)/i,
  /^(.+?)\s+(?:movies|films)$/i,
  /(?:movies|films)\s+by\s+(.+)/i,
  /directed by\s+(.+)/i,
  /from\s+(.+)/i,
];

const extractPromptEntityText = (prompt = "") => {
  const rawPrompt = String(prompt || "").trim();
  const similarityTitle = [
    /movies? like\s+(.+)/i,
    /films? like\s+(.+)/i,
    /similar to\s+(.+)/i,
  ].map((pattern) => rawPrompt.match(pattern)?.[1]?.trim()).find(Boolean);

  if (similarityTitle) {
    return { kind: "movie_title", text: similarityTitle, explicit: true };
  }

  const personMatch = PERSON_WITH_PATTERNS.map((pattern) => rawPrompt.match(pattern)?.[1]?.trim()).find(Boolean);
  if (personMatch) {
    return { kind: "person", text: personMatch, explicit: true };
  }

  return { kind: "raw", text: rawPrompt, explicit: false };
};

const pickBestNamedResult = (results = [], query = "", key = "name") => {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const safeResults = Array.isArray(results) ? results : [];
  return safeResults
    .map((entry) => {
      const name = String(entry?.[key] || "").trim().toLowerCase();
      let score = 0;
      if (name === normalizedQuery) score += 120;
      else if (name.includes(normalizedQuery) || normalizedQuery.includes(name)) score += 70;
      if (entry?.popularity) score += Math.min(entry.popularity, 50) / 5;
      return { entry, score };
    })
    .sort((left, right) => right.score - left.score)[0]?.entry || null;
};

const resolveEntityAnchor = async (prompt = "", parsedIntent = null) => {
  const promptText = String(prompt || "").trim();
  if (!promptText) {
    return null;
  }

  const extracted = extractPromptEntityText(promptText);
  const lowerPrompt = promptText.toLowerCase();
  const wantsDirector = /directed by|director|from\s+[A-Z]/i.test(promptText);
  const wantsActor = /movies? with|films? with|starring|^[A-Za-z.' -]+(?:movies|films)$/i.test(promptText);
  const franchiseHint = /franchise|series|saga|universe/i.test(promptText);
  const franchiseQuery = String(extracted.text || promptText).replace(/(franchise|series|saga|universe|movies|films)/gi, " ").replace(/\s+/g, " ").trim() || String(extracted.text || promptText).trim();

  if (parsedIntent?.anchors?.title) {
    try {
      const payload = await fetchTmdb("/search/movie", { query: parsedIntent.anchors.title, include_adult: "false", page: 1 });
      const movie = pickBestNamedResult(payload.results, parsedIntent.anchors.title, "title");
      if (movie?.id) {
        return {
          kind: "movie_title",
          id: movie.id,
          name: movie.title,
          confidence: "high",
        };
      }
    } catch (error) {
      console.error("Error resolving movie title anchor:", error.response?.data || error.message);
    }
  }

  if (franchiseHint || (!parsedIntent?.anchors?.title && !wantsActor && !wantsDirector)) {
    try {
      const collectionPayload = await fetchTmdb("/search/collection", { query: franchiseQuery, include_adult: "false", page: 1 });
      const collection = pickBestNamedResult(collectionPayload.results, franchiseQuery, "name");
      if (collection?.id) {
        return {
          kind: "franchise",
          id: collection.id,
          name: collection.name,
          confidence: franchiseHint ? "high" : "medium",
        };
      }
    } catch (error) {
      console.error("Error resolving collection anchor:", error.response?.data || error.message);
    }
  }

  try {
    const personPayload = await fetchTmdb("/search/person", { query: extracted.text || promptText, include_adult: "false", page: 1 });
    const person = pickBestNamedResult(personPayload.results, extracted.text || promptText, "name");
    if (person?.id) {
      const normalizedDepartment = String(person.known_for_department || "").toLowerCase();
      const personKind = wantsDirector || normalizedDepartment === "directing"
        ? "director"
        : wantsActor || normalizedDepartment === "acting"
          ? "actor"
          : "actor";
      return {
        kind: personKind,
        id: person.id,
        name: person.name,
        confidence: extracted.explicit ? "high" : "medium",
      };
    }
  } catch (error) {
    console.error("Error resolving person anchor:", error.response?.data || error.message);
  }

  if (!parsedIntent?.anchors?.title) {
    try {
      const payload = await fetchTmdb("/search/movie", { query: extracted.text || promptText, include_adult: "false", page: 1 });
      const movie = pickBestNamedResult(payload.results, extracted.text || promptText, "title");
      if (movie?.id) {
        return {
          kind: "movie_title",
          id: movie.id,
          name: movie.title,
          confidence: "medium",
        };
      }
    } catch (error) {
      console.error("Error resolving fallback movie anchor:", error.response?.data || error.message);
    }
  }

  return null;
};

const getIntentQueryType = (intent = {}) => {
  if (intent?.structured_query?.type === "country") return "COUNTRY";
  if (intent?.structured_query?.type === "awards") return "AWARDS";
  if (intent?.structured_query?.type === "genre_theme") return "GENRE_THEME";
  if (intent?.entity_anchor?.kind === "actor") return "PERSON";
  if (intent?.entity_anchor?.kind === "director") return "DIRECTOR";
  if (intent?.entity_anchor?.kind === "franchise") return "FRANCHISE";
  if (intent?.prompt_type === "title_similarity" || (intent?.entity_anchor?.kind === "movie_title" && /like|similar to/i.test(String(intent?.raw_prompt || "")))) {
    return "TITLE_SIMILARITY";
  }
  if (intent?.prompt_type === "mixed_anchor_modifiers") return "MIXED";
  return "GENRE_OR_VIBE";
};

const normalizePickRefinement = (rawRefinement = {}) => {
  if (!rawRefinement || typeof rawRefinement !== "object") {
    return null;
  }

  const id = String(rawRefinement.id || "").trim().toLowerCase();
  if (!id) {
    return null;
  }

  const allowedIds = new Set(["lighter", "darker", "shorter", "funnier", "less_intense", "more_like_this", "different_angle"]);
  if (!allowedIds.has(id)) {
    return null;
  }

  return {
    id,
    label: String(rawRefinement.label || id).trim(),
    source_movie_id: Number.parseInt(rawRefinement.source_movie_id, 10) || null,
    source_movie_title: String(rawRefinement.source_movie_title || "").trim(),
  };
};

const appendUnique = (list = [], values = []) => Array.from(new Set([...(Array.isArray(list) ? list : []), ...(Array.isArray(values) ? values : [])].filter(Boolean)));

const applyRefinementToIntent = (intent = {}, refinement = null) => {
  if (!refinement?.id) {
    return intent;
  }

  const nextIntent = {
    ...intent,
    tone: Array.isArray(intent.tone) ? intent.tone.slice() : [],
    rubric_keys: Array.isArray(intent.rubric_keys) ? intent.rubric_keys.slice() : [],
    preferred_genre_ids: Array.isArray(intent.preferred_genre_ids) ? intent.preferred_genre_ids.slice() : [],
    avoid_genre_ids: Array.isArray(intent.avoid_genre_ids) ? intent.avoid_genre_ids.slice() : [],
    hard_filters: { ...(intent.hard_filters || {}) },
    emotional_tolerance: { ...(intent.emotional_tolerance || {}) },
    attention_profile: { ...(intent.attention_profile || {}) },
    pacing_energy: { ...(intent.pacing_energy || {}) },
    runtime_commitment: { ...(intent.runtime_commitment || {}) },
    soft_preferences: { ...(intent.soft_preferences || {}) },
    refinement,
  };

  switch (refinement.id) {
    case "lighter":
      nextIntent.tone = nextIntent.tone.filter((value) => value !== "dark");
      nextIntent.tone = appendUnique(nextIntent.tone, ["comforting"]);
      nextIntent.rubric_keys = appendUnique(nextIntent.rubric_keys, ["easy_watch", "comfort_movie"]);
      nextIntent.preferred_genre_ids = appendUnique(nextIntent.preferred_genre_ids, [35, 10749, 16, 10751, 12]);
      nextIntent.avoid_genre_ids = appendUnique(nextIntent.avoid_genre_ids, [27, 53]);
      nextIntent.emotional_tolerance = {
        ...nextIntent.emotional_tolerance,
        level: "light",
        low_stress: true,
        avoid_depressing: true,
      };
      nextIntent.energy_level = "low";
      break;
    case "darker":
      nextIntent.tone = appendUnique(nextIntent.tone, ["dark"]);
      nextIntent.preferred_genre_ids = appendUnique(nextIntent.preferred_genre_ids, [53, 80, 9648]);
      nextIntent.emotional_tolerance = {
        ...nextIntent.emotional_tolerance,
        level: "heavy",
        low_stress: false,
      };
      nextIntent.energy_level = "medium";
      break;
    case "shorter":
      nextIntent.runtime_commitment = {
        ...nextIntent.runtime_commitment,
        max_runtime_minutes: Math.min(Number(nextIntent.runtime_commitment?.max_runtime_minutes || 110) || 110, 110),
        preference: "short",
      };
      nextIntent.hard_filters.max_runtime_minutes = nextIntent.runtime_commitment.max_runtime_minutes;
      nextIntent.rubric_keys = appendUnique(nextIntent.rubric_keys, ["under_two_hours"]);
      break;
    case "funnier":
      nextIntent.tone = appendUnique(nextIntent.tone, ["funny"]);
      nextIntent.rubric_keys = appendUnique(nextIntent.rubric_keys, ["funny", "easy_watch"]);
      nextIntent.preferred_genre_ids = appendUnique(nextIntent.preferred_genre_ids, [35, 10749, 16]);
      nextIntent.avoid_genre_ids = appendUnique(nextIntent.avoid_genre_ids, [27]);
      break;
    case "less_intense":
      nextIntent.rubric_keys = appendUnique(nextIntent.rubric_keys, ["easy_watch", "comfort_movie"]);
      nextIntent.preferred_genre_ids = appendUnique(nextIntent.preferred_genre_ids, [35, 10749, 16, 10751, 12]);
      nextIntent.avoid_genre_ids = appendUnique(nextIntent.avoid_genre_ids, [27, 53, 80, 10752]);
      nextIntent.emotional_tolerance = {
        ...nextIntent.emotional_tolerance,
        level: "light",
        low_stress: true,
        avoid_depressing: true,
      };
      nextIntent.pacing_energy = {
        ...nextIntent.pacing_energy,
        not_exhausting: true,
      };
      break;
    case "more_like_this":
      nextIntent.soft_preferences = {
        ...nextIntent.soft_preferences,
        prefer_similarity: true,
      };
      break;
    case "different_angle":
      nextIntent.soft_preferences = {
        ...nextIntent.soft_preferences,
        prefer_lane_diversity: true,
      };
      break;
    default:
      break;
  }

  nextIntent.lane_key = `${intent.lane_key || "generic"}:refine:${refinement.id}`;
  return nextIntent;
};

const hydrateResolvedIntent = async (preferences = {}, rawPreferences = {}) => {
  const refinement = normalizePickRefinement(rawPreferences.refinement);

  if (isIntentSnapshotValid(rawPreferences.intent_snapshot)) {
    const snapshot = rawPreferences.intent_snapshot;
    const hydratedSnapshot = snapshot.query_type ? snapshot : { ...snapshot, query_type: getIntentQueryType(snapshot) };
    return applyRefinementToIntent(hydratedSnapshot, refinement);
  }

  const parsedIntent = parseReelbotIntent(preferences.prompt);
  const entityAnchor = await resolveEntityAnchor(preferences.prompt, parsedIntent);
  const structuredQuery = parsedIntent.structured_query_hint || null;
  const hydratedIntent = entityAnchor ? { ...parsedIntent, entity_anchor: entityAnchor } : parsedIntent;
  const intentWithStructuredHint = structuredQuery ? { ...hydratedIntent, structured_query: structuredQuery } : hydratedIntent;
  const finalIntent = { ...intentWithStructuredHint, query_type: getIntentQueryType(intentWithStructuredHint) };
  return applyRefinementToIntent(finalIntent, refinement);
};

const isMovieValidForIntent = (movie, intent = {}, promptBoosts = {}) => {
  const queryType = intent?.query_type || getIntentQueryType(intent);
  if (!movie?.id) {
    return false;
  }

  if (!passesAudienceGuardrails(movie, intent)) {
    return false;
  }

  const runtime = Number(movie.runtime || 0);
  const hardFilters = intent.hard_filters || {};
  const knownBadPatternResult = getKnownBadPatternAdjustments(movie, intent);

  if (knownBadPatternResult.hardReject) {
    return false;
  }

  if (hardFilters.max_runtime_minutes && runtime && runtime > hardFilters.max_runtime_minutes) {
    return false;
  }

  if (hardFilters.min_runtime_minutes && runtime && runtime < hardFilters.min_runtime_minutes) {
    return false;
  }

  if (Array.isArray(hardFilters.exclude_genre_ids) && matchesAnyGenre(movie.genre_ids || [], hardFilters.exclude_genre_ids)) {
    return false;
  }

  if (queryType === "PERSON") {
    return Boolean(promptBoosts?.actorMovieIds?.has(movie.id));
  }

  if (queryType === "DIRECTOR") {
    return Boolean(promptBoosts?.directorMovieIds?.has(movie.id));
  }

  if (queryType === "FRANCHISE") {
    return Boolean(promptBoosts?.franchiseMovieIds?.has(movie.id));
  }

  if (queryType === "TITLE_SIMILARITY") {
    return Boolean(promptBoosts?.titleSimilarMovieIds?.has(movie.id) || promptBoosts?.constrainedAnchorMovieIds?.has(movie.id));
  }

  if (queryType === "COUNTRY" || queryType === "AWARDS" || queryType === "GENRE_THEME") {
    return Boolean(promptBoosts?.structuredMovieIds?.has(movie.id));
  }

  return true;
};

const getPromptMovieBoosts = async (prompt = "", intent = null) => {
  const normalizedPrompt = String(prompt || "").trim().toLowerCase();

  if (!normalizedPrompt) {
    return {
      personMovieIds: new Set(),
      actorMovieIds: new Set(),
      directorMovieIds: new Set(),
      franchiseMovieIds: new Set(),
      titleSimilarMovieIds: new Set(),
      anchorMovieIds: new Set(),
      searchedMovieIds: new Set(),
      constrainedAnchorMovieIds: new Set(),
      anchorGenreIds: [],
      promptTokens: [],
      entityAnchor: intent?.entity_anchor || null,
      structuredMovieIds: new Set(),
    };
  }

  const intentCacheKey = intent?.lane_key ? (normalizedPrompt + ":" + intent.lane_key) : normalizedPrompt;

  if (promptLookupCache.has(intentCacheKey)) {
    return promptLookupCache.get(intentCacheKey);
  }

  const promptTokens = tokenizePrompt(prompt).filter((token) => !PROMPT_STOPWORDS.has(token));
  const result = {
    personMovieIds: new Set(),
    actorMovieIds: new Set(),
    directorMovieIds: new Set(),
    franchiseMovieIds: new Set(),
    titleSimilarMovieIds: new Set(),
    anchorMovieIds: new Set(),
    searchedMovieIds: new Set(),
    constrainedAnchorMovieIds: new Set(),
    anchorGenreIds: [],
    promptTokens,
    entityAnchor: intent?.entity_anchor || null,
    structuredMovieIds: new Set(
      Array.isArray(intent?.structured_query?.movie_ids)
        ? intent.structured_query.movie_ids.map((value) => Number.parseInt(value, 10)).filter(Boolean)
        : []
    ),
  };
  const queries = getPromptSearchQueries(prompt);

  if (intent?.anchors?.person) {
    queries.unshift(String(intent.anchors.person).toLowerCase());
  }

  if (intent?.anchors?.title) {
    queries.unshift(String(intent.anchors.title).toLowerCase());
  }

  if (intent?.entity_anchor?.name) {
    queries.unshift(String(intent.entity_anchor.name).toLowerCase());
  }

  if (intent?.entity_anchor?.kind === "actor" || intent?.entity_anchor?.kind === "director") {
    try {
      const personId = intent.entity_anchor.id;
      const credits = await fetchTmdb("/person/" + personId + "/movie_credits");
      const actorMovies = credits.cast || [];
      const directorMovies = (credits.crew || []).filter((entry) => entry.job === "Director");

      actorMovies.forEach((movie) => {
        if (movie?.id) {
          result.personMovieIds.add(movie.id);
          result.actorMovieIds.add(movie.id);
          if (intent.entity_anchor.kind === "actor") {
            result.constrainedAnchorMovieIds.add(movie.id);
          }
        }
      });

      directorMovies.forEach((movie) => {
        if (movie?.id) {
          result.personMovieIds.add(movie.id);
          result.directorMovieIds.add(movie.id);
          if (intent.entity_anchor.kind === "director") {
            result.constrainedAnchorMovieIds.add(movie.id);
          }
        }
      });
    } catch (error) {
      console.error("Error resolving entity person anchor:", error.response?.data || error.message);
    }
  }

  if (intent?.entity_anchor?.kind === "franchise") {
    try {
      const collection = await fetchTmdb("/collection/" + intent.entity_anchor.id);
      (collection.parts || []).forEach((movie) => {
        if (movie?.id) {
          result.franchiseMovieIds.add(movie.id);
          result.constrainedAnchorMovieIds.add(movie.id);
        }
      });
    } catch (error) {
      console.error("Error resolving franchise anchor:", error.response?.data || error.message);
    }
  }

  if (intent?.entity_anchor?.kind === "movie_title" || intent?.anchors?.title) {
    try {
      const anchorMovieId = intent?.entity_anchor?.kind === "movie_title" ? intent.entity_anchor.id : null;
      const anchorMovie = anchorMovieId
        ? await fetchTmdb("/movie/" + anchorMovieId)
        : pickBestNamedResult((await fetchTmdb("/search/movie", { query: intent.anchors.title, include_adult: "false", page: 1 })).results, intent.anchors.title, "title");
      if (anchorMovie?.id) {
        result.anchorMovieIds.add(anchorMovie.id);
        result.anchorGenreIds = Array.isArray(anchorMovie.genre_ids) ? anchorMovie.genre_ids.slice() : Array.isArray(anchorMovie.genres) ? anchorMovie.genres.map((genre) => genre.id) : [];
        const [similarPayload, recommendationPayload] = await Promise.allSettled([
          fetchTmdb("/movie/" + anchorMovie.id + "/similar"),
          fetchTmdb("/movie/" + anchorMovie.id + "/recommendations"),
        ]);
        [similarPayload, recommendationPayload]
          .filter((response) => response.status === "fulfilled")
          .flatMap((response) => response.value?.results || [])
          .forEach((movie) => {
            if (movie?.id && movie.id !== anchorMovie.id) {
              result.titleSimilarMovieIds.add(movie.id);
              result.constrainedAnchorMovieIds.add(movie.id);
            }
          });
      }
    } catch (error) {
      console.error("Error resolving prompt title anchor:", error.response?.data || error.message);
    }
  }

  const movieQueries = [...new Set([
    normalizedPrompt,
    ...queries,
    ...(intent?.thematic_terms || []).map((term) => term + " movie"),
  ])].slice(0, 8);

  for (const query of movieQueries) {
    try {
      const payload = await fetchTmdb("/search/movie", { query, include_adult: "false", page: 1 });
      (payload.results || []).slice(0, 8).forEach((movie) => {
        if (movie?.id) {
          result.searchedMovieIds.add(movie.id);
        }
      });
    } catch (error) {
      console.error("Error resolving prompt movie hints:", error.response?.data || error.message);
    }
  }

  for (const query of queries) {
    try {
      const payload = await fetchTmdb("/search/person", { query, include_adult: "false", page: 1 });
      const person = (payload.results || []).find((entry) => {
        const name = String(entry?.name || "").toLowerCase();
        return name && (name.includes(query) || query.includes(name));
      });

      if (!person?.id) {
        continue;
      }

      const credits = await fetchTmdb("/person/" + person.id + "/movie_credits");
      (credits.cast || []).forEach((movie) => {
        if (movie?.id) {
          result.personMovieIds.add(movie.id);
        }
      });
      break;
    } catch (error) {
      console.error("Error resolving prompt person hints:", error.response?.data || error.message);
    }
  }

  promptLookupCache.set(intentCacheKey, result);
  return result;
};

const getPromptSignals = (prompt = "") => {
  const normalizedPrompt = String(prompt || "").toLowerCase();

  const mood = normalizedPrompt.match(/mind|twist|weird|sci-?fi|smart|clever/)
    ? "mind_bending"
    : normalizedPrompt.match(/easy watch|comfort|cozy|breezy|lazy sunday|feel-good|feel good/)
      ? "easy_watch"
      : normalizedPrompt.match(/funny|comedy|laugh/)
        ? "funny"
        : normalizedPrompt.match(/dark|grim|creepy|horror|brooding|noir/)
          ? "dark"
          : normalizedPrompt.match(/emotional|romance|feel|moving|heart|heartfelt/)
            ? "feel_something"
            : null;

  const runtime = normalizedPrompt.match(/under\s*2\s*hours|under\s*two\s*hours|short|quick|tight/)
    ? "under_two_hours"
    : normalizedPrompt.match(/over\s*2\s*hours|over\s*two\s*hours|epic|long|immersive|sweep/)
      ? "over_two_hours"
      : null;

  const company = normalizedPrompt.match(/date|partner|together|romantic/)
    ? "pair"
    : normalizedPrompt.match(/friends|group|crowd|party/)
      ? "friends"
      : normalizedPrompt.match(/solo|alone|myself/)
        ? "solo"
        : null;

  return { mood, runtime, company };
};

const getPromptPreferenceProfile = (prompt = "") => {
  const normalizedPrompt = String(prompt || "").toLowerCase();
  const hasTenseLanguage = /tense|thriller|intense|edge|suspense|suspenseful/.test(normalizedPrompt);
  const avoidsBleakness = /not depressing|not miserable|not too heavy|not bleak|without being miserable|without being depressing/.test(normalizedPrompt);

  return {
    visuallyStunning: /visual|visually stunning|stunning|cinematic|gorgeous|beautiful|spectacle|epic|sweeping|lush/.test(normalizedPrompt),
    tenseButNotMiserable: hasTenseLanguage && avoidsBleakness,
    easyWatch: /easy watch|easy|light|comfort|cozy|breezy|feel good|feel-good|lazy sunday|relaxed/.test(normalizedPrompt),
    smartTwisty: /smart|twist|twisty|mind-bending|mind bending|clever|brainy|mystery|sci-?fi|weird/.test(normalizedPrompt),
    dark: /dark|grim|brooding|moody|noir|creepy/.test(normalizedPrompt),
    emotional: /emotional|moving|heart|heartfelt|tearjerker|feel something|tender|romance/.test(normalizedPrompt),
  };
};

const getPromptSpecificFitScore = (movie, promptProfile = {}) => {
  const genreIds = movie.genre_ids || [];
  const runtime = Number(movie.runtime || 0);
  let score = 0;

  if (promptProfile.visuallyStunning) {
    if (matchesAnyGenre(genreIds, [878, 14, 12, 16, 36])) score += 22;
    if (matchesAnyGenre(genreIds, [28, 18])) score += 10;
    if ((movie.vote_average || 0) >= 7.0) score += 6;
    if ((movie.popularity || 0) >= 30) score += 4;
    if (matchesAnyGenre(genreIds, [10751, 35]) && !matchesAnyGenre(genreIds, [878, 14, 12, 16, 36, 18])) score -= 20;
  }

  if (promptProfile.tenseButNotMiserable) {
    if (matchesAnyGenre(genreIds, [53, 9648, 28])) score += 22;
    if (matchesAnyGenre(genreIds, [80])) score += 7;
    if (matchesAnyGenre(genreIds, [27, 10752])) score -= 20;
    if (matchesAnyGenre(genreIds, [18]) && !matchesAnyGenre(genreIds, [53, 9648, 28])) score -= 12;
  }

  if (promptProfile.easyWatch) {
    if (matchesAnyGenre(genreIds, [35, 10749, 12, 16, 10751])) score += 22;
    if (matchesAnyGenre(genreIds, [27, 53, 10752, 80])) score -= 20;
    if (runtime && runtime > 140) score -= 8;
  }

  if (promptProfile.smartTwisty) {
    if (matchesAnyGenre(genreIds, [878, 9648, 53])) score += 22;
    if ((movie.vote_average || 0) >= 7.0) score += 6;
    if (matchesAnyGenre(genreIds, [10751, 10749, 35]) && !matchesAnyGenre(genreIds, [878, 9648, 53])) score -= 18;
  }

  if (promptProfile.dark) {
    if (matchesAnyGenre(genreIds, [53, 80, 27])) score += 20;
    if (matchesAnyGenre(genreIds, [18])) score += 6;
    if (matchesAnyGenre(genreIds, [10751, 16, 35])) score -= 18;
  }

  if (promptProfile.emotional) {
    if (matchesAnyGenre(genreIds, [18, 10749, 10402, 16])) score += 20;
    if ((movie.vote_average || 0) >= 7.0) score += 6;
    if (matchesAnyGenre(genreIds, [27])) score -= 14;
  }

  return score;
};

const getIntentSpecificFitScore = (movie, intent = {}, promptBoosts = {}) => {
  let score = 0;
  const genreIds = movie.genre_ids || [];
  const runtime = Number(movie.runtime || 0);
  const titleMatches = countPromptMatches(movie.title, promptBoosts.promptTokens || []);
  const overviewMatches = countPromptMatches(movie.overview, promptBoosts.promptTokens || []);
  const thematicMatches = (intent.thematic_terms || []).reduce((count, term) => {
    const normalizedTerm = String(term || "").toLowerCase();
    return String(movie.title || "").toLowerCase().includes(normalizedTerm) || String(movie.overview || "").toLowerCase().includes(normalizedTerm)
      ? count + 1
      : count;
  }, 0);
  const preferredGenreIds = Array.isArray(intent.preferred_genre_ids) ? intent.preferred_genre_ids : [];
  const avoidGenreIds = Array.isArray(intent.avoid_genre_ids) ? intent.avoid_genre_ids : [];
  const hasPreferredGenres = preferredGenreIds.length ? matchesAnyGenre(genreIds, preferredGenreIds) : true;
  const entityKind = intent?.entity_anchor?.kind || null;
  const entityMovieIds = entityKind === "actor"
    ? promptBoosts.actorMovieIds
    : entityKind === "director"
      ? promptBoosts.directorMovieIds
      : entityKind === "franchise"
        ? promptBoosts.franchiseMovieIds
        : entityKind === "movie_title"
          ? promptBoosts.constrainedAnchorMovieIds
          : null;

  if (promptBoosts.personMovieIds?.has(movie.id)) {
    score += 58;
  }

  if (entityMovieIds?.has(movie.id)) {
    score += entityKind === "movie_title" ? 52 : 72;
  }

  if (promptBoosts.titleSimilarMovieIds?.has(movie.id)) {
    score += 46;
  }

  if (promptBoosts.searchedMovieIds?.has(movie.id)) {
    score += 18;
  }

  if (promptBoosts.anchorMovieIds?.has(movie.id) && intent.prompt_type === "title_similarity") {
    score -= 90;
  }

  if (entityKind === "actor" || entityKind === "director" || entityKind === "franchise") {
    if (entityMovieIds && !entityMovieIds.has(movie.id)) {
      score -= 96;
    }
  } else if (intent.prompt_type === "person_anchor" || (intent.prompt_type === "mixed_anchor_modifiers" && intent.anchors?.person)) {
    if (!promptBoosts.personMovieIds?.has(movie.id)) {
      score -= 34;
    }
  }

  if (intent.prompt_type === "title_similarity" || (intent.prompt_type === "mixed_anchor_modifiers" && intent.anchors?.title)) {
    if (!promptBoosts.titleSimilarMovieIds?.has(movie.id)) {
      score -= 26;
    }
    if (promptBoosts.anchorGenreIds?.length && !matchesAnyGenre(genreIds, promptBoosts.anchorGenreIds)) {
      score -= 22;
    }
  }

  if (preferredGenreIds.length) {
    if (hasPreferredGenres) {
      score += 24;
    } else {
      score -= 34;
    }
  }

  if (avoidGenreIds.length && matchesAnyGenre(genreIds, avoidGenreIds)) {
    score -= 26;
  }

  if (thematicMatches > 0) {
    score += thematicMatches * 14;
  } else if ((intent.thematic_terms || []).length) {
    score -= 18;
  }

  if (intent.rubric_keys?.includes("less_accessible")) {
    if (runtime >= 115) score += 6;
    if ((movie.vote_average || 0) >= 7.1) score += 5;
    if (matchesAnyGenre(genreIds, [10751, 35]) && !matchesAnyGenre(genreIds, [18, 9648, 878, 80])) score -= 18;
  }

  if (intent.rubric_keys?.includes("under_two_hours")) {
    if (runtime && runtime <= 120) score += 28;
    if (runtime > 120) score -= 24;
  }

  if (intent.rubric_keys?.includes("date_night")) {
    if (matchesAnyGenre(genreIds, [10749, 35, 18, 12])) score += 16;
    if (matchesAnyGenre(genreIds, [27]) && !matchesAnyGenre(genreIds, [35])) score -= 16;
  }

  if (intent.rubric_keys?.includes("strong_acting")) {
    if (matchesAnyGenre(genreIds, [18])) score += 14;
    if ((movie.vote_average || 0) >= 7.2) score += 6;
  }

  if (intent.rubric_keys?.includes("funny") && matchesAnyGenre(genreIds, [35])) score += 20;
  if (intent.rubric_keys?.includes("comfort_movie")) {
    if (matchesAnyGenre(genreIds, [35, 16, 10749, 10751, 12])) score += 18;
    if (matchesAnyGenre(genreIds, [27, 53, 80])) score -= 24;
  }

  if (intent.tone?.includes("funny") && matchesAnyGenre(genreIds, [35])) score += 18;
  if (intent.tone?.includes("dark") && matchesAnyGenre(genreIds, [53, 80, 27])) score += 18;
  if (intent.tone?.includes("tense") && matchesAnyGenre(genreIds, [53, 9648, 28])) score += 18;
  if (intent.tone?.includes("visual") && matchesAnyGenre(genreIds, [878, 14, 12, 16, 36, 28])) score += 18;
  if (intent.tone?.includes("idea-driven") && matchesAnyGenre(genreIds, [878, 9648, 53])) score += 20;
  if (intent.tone?.includes("comforting") && matchesAnyGenre(genreIds, [35, 16, 10749, 10751, 12])) score += 18;

  if (intent.emotional_weight === "light") {
    if (matchesAnyGenre(genreIds, [35, 12, 10749, 16, 10751])) score += 16;
    if (matchesAnyGenre(genreIds, [27, 10752])) score -= 18;
  }

  if (intent.emotional_weight === "medium-dark") {
    if (matchesAnyGenre(genreIds, [53, 9648, 80])) score += 14;
    if (matchesAnyGenre(genreIds, [27, 10752])) score -= 14;
  }

  if (intent.emotional_weight === "heavy") {
    if (matchesAnyGenre(genreIds, [18])) score += 18;
    if (matchesAnyGenre(genreIds, [35, 10751]) && !matchesAnyGenre(genreIds, [18, 10749])) score -= 28;
  }

  if (intent.accessibility === "demanding") {
    if (matchesAnyGenre(genreIds, [35, 10751]) && !matchesAnyGenre(genreIds, [9648, 18, 878])) score -= 18;
  }

  if (intent.accessibility === "accessible") {
    if (runtime && runtime <= 125) score += 6;
  }

  if (intent.attention_profile?.level === "background") {
    if (matchesAnyGenre(genreIds, [35, 16, 10749, 10751, 12])) score += 18;
    if (matchesAnyGenre(genreIds, [9648, 53, 80]) && !matchesAnyGenre(genreIds, [35])) score -= 18;
  }

  if (intent.attention_profile?.level === "easy") {
    if (runtime && runtime <= 120) score += 10;
    if (matchesAnyGenre(genreIds, [35, 16, 10749, 10751, 12])) score += 10;
  }

  if (intent.attention_profile?.level === "immersive") {
    if (matchesAnyGenre(genreIds, [878, 14, 12, 18, 53])) score += 14;
    if (runtime >= 115) score += 8;
  }

  if (intent.pacing_energy?.pacing === "slow_burn") {
    if (matchesAnyGenre(genreIds, [18, 9648, 80])) score += 12;
    if (matchesAnyGenre(genreIds, [35, 10751]) && !matchesAnyGenre(genreIds, [18, 9648])) score -= 10;
  }

  if (intent.pacing_energy?.pacing === "fast_moving") {
    if (matchesAnyGenre(genreIds, [53, 28, 12])) score += 16;
    if (runtime && runtime > 150) score -= 10;
  }

  if (intent.pacing_energy?.immediate_hook) {
    if (matchesAnyGenre(genreIds, [53, 28, 12, 35])) score += 10;
  }

  if (intent.pacing_energy?.not_exhausting) {
    if (matchesAnyGenre(genreIds, [27, 10752])) score -= 16;
    if (matchesAnyGenre(genreIds, [35, 16, 10749, 10751, 12])) score += 10;
  }

  score += getAudienceContextFitScore(movie, intent);

  if (intent.normalized_prompt?.includes("courtroom") || intent.normalized_prompt?.includes("legal") || intent.normalized_prompt?.includes("trial")) {
    const courtroomSignal = /court|trial|lawyer|legal|attorney|judge|jury/i.test(String(movie.title || "") + " " + String(movie.overview || ""));
    score += courtroomSignal ? 56 : -88;
    if (!matchesAnyGenre(genreIds, [18])) score -= 34;
    if (matchesAnyGenre(genreIds, [35, 10751, 28]) && !courtroomSignal) score -= 44;
  }

  if (intent.normalized_prompt?.includes("sci-fi") || intent.normalized_prompt?.includes("scifi") || intent.normalized_prompt?.includes("science fiction")) {
    score += matchesAnyGenre(genreIds, [878]) ? 26 : -32;
  }

  if (intent.normalized_prompt?.includes("emotionally heavy drama")) {
    if (matchesAnyGenre(genreIds, [18])) score += 22;
    if (matchesAnyGenre(genreIds, [35, 10751, 28]) && !matchesAnyGenre(genreIds, [10749, 10402])) score -= 42;
  }

  if (intent.normalized_prompt?.includes("drama") && !matchesAnyGenre(genreIds, [18])) {
    score -= 24;
  }

  if (intent.runtime_commitment?.preference === "short" && runtime) {
    if (runtime <= 95) score += 18;
    if (runtime > 120) score -= 24;
  }

  if (intent.runtime_commitment?.preference === "manageable" && runtime) {
    if (runtime <= 120) score += 14;
    if (runtime > 140) score -= 14;
  }

  if (intent.runtime_commitment?.preference === "epic" && runtime) {
    if (runtime >= 140) score += 16;
    if (runtime && runtime < 110) score -= 10;
  }

  if (intent.refinement?.id === "more_like_this") {
    if (intent.soft_preferences?.prefer_similarity) {
      if (promptBoosts.titleSimilarMovieIds?.has(movie.id)) score += 20;
      if (promptBoosts.constrainedAnchorMovieIds?.has(movie.id)) score += 14;
    }
  }

  if (intent.refinement?.id === "different_angle") {
    if (matchesAnyGenre(genreIds, intent.preferred_genre_ids || [])) score += 10;
    if (promptBoosts.titleSimilarMovieIds?.has(movie.id)) score -= 6;
  }

  score += titleMatches * 10;
  score += overviewMatches * 4;
  score += getKnownBadPatternAdjustments(movie, intent).scoreAdjustment;

  return score;
};

const resolvePickPreferences = (preferences = {}) => {
  const prompt = String(preferences.prompt || "").trim();
  const promptSignals = getPromptSignals(prompt);

  const view = normalizeDiscoveryView(preferences.view);
  const source = normalizePickSource(preferences.source);
  const mood = normalizePreferenceKey(preferences.mood, PICK_MOOD_CONFIG, promptSignals.mood || "all");
  const runtime = normalizePreferenceKey(preferences.runtime, PICK_RUNTIME_CONFIG, promptSignals.runtime || "any");
  const company = normalizePreferenceKey(preferences.company, PICK_COMPANY_CONFIG, promptSignals.company || "any");
  const genre = normalizePickGenre(preferences.genre);

  return {
    view,
    source,
    mood,
    runtime,
    company,
    genre,
    prompt,
    request_mode: preferences.is_swap ? "swap" : "fresh",
    behavioral_memory: normalizeBehavioralMemory(preferences.behavioral_memory),
  };
};

const formatPickPromptForSummary = (prompt = "") => {
  const normalizedPrompt = String(prompt || "").trim();
  return normalizedPrompt ? `“${truncateText(normalizedPrompt, 72)}”` : "";
};

const getPickSummaryMoodPhrase = (mood) => {
  switch (mood) {
    case "easy_watch":
      return "easy to get into";
    case "mind_bending":
      return "smart and twisty";
    case "dark":
      return "darker and more intense";
    case "funny":
      return "funny";
    case "feel_something":
      return "a little more emotional";
    default:
      return "";
  }
};

const getPickSummaryCompanyPhrase = (company) => {
  switch (company) {
    case "solo":
      return "good for a solo watch";
    case "pair":
      return "good for date night";
    case "friends":
      return "good with friends";
    default:
      return "";
  }
};

const getPickSummaryRuntimePhrase = (runtime) => {
  switch (runtime) {
    case "under_two_hours":
      return "that lands under two hours";
    case "over_two_hours":
      return "worth settling into for the night";
    default:
      return "";
  }
};

const buildPickSetupPhrase = (preferences) =>
  joinReasonClauses(
    [
      preferences.mood !== "all" ? getPickSummaryMoodPhrase(preferences.mood) : "",
      preferences.company !== "any" ? getPickSummaryCompanyPhrase(preferences.company) : "",
      preferences.runtime !== "any" ? getPickSummaryRuntimePhrase(preferences.runtime) : "",
    ].filter(Boolean)
  );

const buildPickSuccessSummary = (movie) => {
  const overview = String(movie?.overview || "").trim();
  const firstSentence = overview.match(/[^.!?]+[.!?]/)?.[0]?.trim();

  if (firstSentence) {
    return truncateText(firstSentence, 140);
  }

  const genreNames = Array.isArray(movie?.genre_names) && movie.genre_names.length
    ? movie.genre_names.slice(0, 2).join(" / ")
    : Array.isArray(movie?.genre_ids)
      ? movie.genre_ids.map((genreId) => TMDB_MOVIE_GENRE_LOOKUP[genreId]).filter(Boolean).slice(0, 2).join(" / ")
      : "";

  if (genreNames && movie?.runtime) {
    return `${genreNames} energy with a ${movie.runtime}-minute runtime that keeps the night moving.`;
  }

  if (genreNames) {
    return `${genreNames} energy makes this a strong place to start.`;
  }

  return "A strong first watch with clear tone and enough momentum to feel like a confident choice.";
};

const buildPickNoMatchSummary = (preferences) => {
  const promptLabel = formatPickPromptForSummary(preferences.prompt);

  if (promptLabel) {
    return `Nothing felt quite right for ${promptLabel} just yet. Try loosening the filters a little.`;
  }

  const setupPhrase = buildPickSetupPhrase(preferences);

  if (setupPhrase) {
    return `Nothing felt quite right for something ${setupPhrase} just yet. Try loosening the filters a little.`;
  }

  return preferences.source === "library"
    ? "Nothing felt like the right call from the full library just yet. Try broadening the filters a little."
    : "Nothing on this page felt like the right call just yet. Try broadening the filters a little.";
};

const buildPickErrorSummary = (preferences) =>
  preferences.source === "library"
    ? "ReelBot hit a snag while lining up something from the full library. Try again, or loosen the filters a little."
    : "ReelBot hit a snag while lining up a pick from this page. Try again, or loosen the filters a little.";

const buildDiscoverParams = (type = "latest", pageNumber = 1, options = {}) => {
  const normalizedType = normalizeDiscoveryView(type);
  const runtime = normalizePreferenceKey(options.runtime, PICK_RUNTIME_CONFIG, "any");

  const todayDate = new Date();
  const today = formatDate(todayDate);
  const threeMonthsAgo = new Date(todayDate);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const formattedThreeMonthsAgo = formatDate(threeMonthsAgo);
  const tomorrow = new Date(todayDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const formattedTomorrow = formatDate(tomorrow);
  const sixMonthsOut = new Date(todayDate);
  sixMonthsOut.setMonth(sixMonthsOut.getMonth() + 6);
  const formattedSixMonthsOut = formatDate(sixMonthsOut);

  const params = {
    region: "US",
    include_adult: "false",
    with_release_type: "2|3",
    with_original_language: "en",
    without_genres: "99,10770",
    page: pageNumber,
  };

  if (options.genre) {
    params.with_genres = String(options.genre);
  }

  if (runtime !== "any") {
    const runtimeConfig = PICK_RUNTIME_CONFIG[runtime];
    if (runtimeConfig.min) {
      params["with_runtime.gte"] = runtimeConfig.min;
    }
    if (runtimeConfig.max) {
      params["with_runtime.lte"] = runtimeConfig.max;
    }
  }

  if (normalizedType === "popular") {
    return {
      ...params,
      sort_by: "popularity.desc",
      "primary_release_date.lte": today,
      "release_date.lte": today,
      "vote_count.gte": 120,
      "vote_average.gte": 5.5,
    };
  }

  if (normalizedType === "upcoming") {
    return {
      ...params,
      sort_by: "popularity.desc",
      "primary_release_date.gte": formattedTomorrow,
      "primary_release_date.lte": formattedSixMonthsOut,
      "release_date.gte": formattedTomorrow,
      "release_date.lte": formattedSixMonthsOut,
    };
  }

  return {
    ...params,
    sort_by: "primary_release_date.desc",
    "primary_release_date.gte": formattedThreeMonthsAgo,
    "primary_release_date.lte": today,
    "release_date.gte": formattedThreeMonthsAgo,
    "release_date.lte": today,
    "vote_count.gte": 5,
    "vote_average.gte": 5,
  };
};

const matchesAnyGenre = (genreIds = [], preferredGenreIds = []) => preferredGenreIds.some((genreId) => genreIds.includes(genreId));

const getMoodMismatchPenalty = (movie, preferences) => {
  const genreIds = movie.genre_ids || [];

  if (preferences.mood === "dark" && matchesAnyGenre(genreIds, [35, 10751])) {
    return 18;
  }

  if (preferences.mood === "funny" && matchesAnyGenre(genreIds, [27, 80])) {
    return 14;
  }

  if (preferences.mood === "easy_watch" && matchesAnyGenre(genreIds, [27, 80, 53])) {
    return 12;
  }

  if (preferences.mood === "feel_something" && matchesAnyGenre(genreIds, [27])) {
    return 14;
  }

  if (preferences.mood === "mind_bending" && matchesAnyGenre(genreIds, [10751, 35]) && !matchesAnyGenre(genreIds, [878, 9648, 53])) {
    return 12;
  }

  return 0;
};

const getPromptTonePenalty = (movie, preferences) => {
  const prompt = String(preferences.prompt || "").toLowerCase();
  const genreIds = movie.genre_ids || [];

  if (!prompt) {
    return 0;
  }

  if (/tense|thriller|intense/.test(prompt) && matchesAnyGenre(genreIds, [35, 10751]) && !matchesAnyGenre(genreIds, [53, 80, 9648, 28])) {
    return 18;
  }

  if (/not depressing|not miserable|easy watch|light|comfort|breezy|gentle/.test(prompt) && matchesAnyGenre(genreIds, [27, 53])) {
    return 16;
  }

  if (/sci-?fi|smart|twisty|weird|clever/.test(prompt) && matchesAnyGenre(genreIds, [10751, 10749]) && !matchesAnyGenre(genreIds, [878, 9648, 53])) {
    return 14;
  }

  if (/visual|stunning|cinematic|spectacle/.test(prompt) && matchesAnyGenre(genreIds, [10751, 35]) && !matchesAnyGenre(genreIds, [878, 14, 12, 16, 36, 18])) {
    return 16;
  }

  if (/emotional|moving|heart/.test(prompt) && matchesAnyGenre(genreIds, [27, 53]) && !matchesAnyGenre(genreIds, [18, 10749, 10402, 16])) {
    return 12;
  }

  return 0;
};

const dedupeMoviesById = (movies = []) => {
  const seenIds = new Set();
  const deduped = [];

  movies.forEach((movie) => {
    if (!movie?.id || seenIds.has(movie.id)) {
      return;
    }

    seenIds.add(movie.id);
    deduped.push(movie);
  });

  return deduped;
};

const getMovieSignalScore = (movie = {}) => {
  const popularity = Number(movie.popularity || 0);
  const voteCount = Number(movie.vote_count || 0);
  const voteAverage = Number(movie.vote_average || 0);

  return popularity * 0.5 + voteCount * 0.3 + voteAverage * 0.2;
};

const withMovieSource = (movies = [], sourceType, sourceEndpoint) =>
  (Array.isArray(movies) ? movies : []).map((movie) => ({
    ...movie,
    source_type: sourceType,
    source_endpoint: sourceEndpoint,
    signal_score: getMovieSignalScore(movie),
  }));

const isReleaseFeedMovie = (movie = {}) => ["now_playing", "upcoming"].includes(movie.source_type);

const hasEnoughMovieSignal = (movie = {}) => isReleaseFeedMovie(movie) || getMovieSignalScore(movie) > SIGNAL_SCORE_THRESHOLD;

const buildSearchResultScore = (movie = {}, query = "") => {
  const titleMatchScore = getSearchTitleMatchScore(query, movie.title);
  const signalScore = getMovieSignalScore(movie);
  const exactMatch = normalizeSearchText(query) === normalizeSearchText(movie.title);
  const hasPoster = Boolean(movie.poster_path);
  const releaseYear = getMovieReleaseYear(movie);
  let score = titleMatchScore + signalScore;

  if (exactMatch) {
    score += 60;
  }

  if (hasPoster) {
    score += 10;
  } else {
    score -= 18;
  }

  if (releaseYear && releaseYear >= 2000) {
    score += 3;
  }

  if ((movie.popularity || 0) < 1 && (movie.vote_count || 0) < 1) {
    score -= 20;
  }

  return {
    score,
    exactMatch,
  };
};

const rankSearchResults = (results = [], query = "") =>
  dedupeMoviesById(withMovieSource(results, "search", "/search/movie"))
    .map((movie) => {
      const ranking = buildSearchResultScore(movie, query);
      return {
        ...movie,
        search_score: Number(ranking.score.toFixed(1)),
        exact_match: ranking.exactMatch,
      };
    })
    .filter((movie) => movie.exact_match || movie.search_score >= 18 || (movie.poster_path && movie.search_score >= 10))
    .sort((left, right) => right.search_score - left.search_score);

const getPickGenreParam = (preferences) => {
  const genreIds = new Set(getGenreFilterIds(preferences.genre));

  if (preferences.mood !== "all") {
    PICK_MOOD_CONFIG[preferences.mood].genreIds.forEach((genreId) => genreIds.add(genreId));
  }

  if (preferences.company !== "any") {
    PICK_COMPANY_CONFIG[preferences.company].genreIds.forEach((genreId) => genreIds.add(genreId));
  }

  return genreIds.size ? Array.from(genreIds).join(",") : undefined;
};

const isLowSignalMovie = (movie) => {
  if (!movie?.id || !movie.poster_path || !movie.overview || movie.adult) {
    return true;
  }

  return !hasEnoughMovieSignal(movie);
};

const buildUpcomingDiscoverFallbackParams = (pageNumber = 1) => {
  const todayDate = new Date();
  const today = formatDate(todayDate);
  const nextYear = new Date(todayDate);
  nextYear.setMonth(nextYear.getMonth() + 12);

  return {
    region: "US",
    include_adult: "false",
    with_release_type: "2|3",
    without_genres: "99,10770",
    sort_by: "primary_release_date.asc",
    "primary_release_date.gte": today,
    "primary_release_date.lte": formatDate(nextYear),
    "release_date.gte": today,
    "release_date.lte": formatDate(nextYear),
    page: pageNumber,
  };
};

const fetchFeedBatch = async (type, pageNumber) => {
  const normalizedType = normalizeDiscoveryView(type);
  const ttlMs = getFeedCacheTtl(normalizedType);

  if (normalizedType === "popular") {
    const payload = await fetchTmdbCached("/trending/movie/week", { page: pageNumber }, ttlMs);
    return {
      results: filterPopularResults(withMovieSource(payload.results, "popular", "/trending/movie/week")),
      total_pages: payload.total_pages || 1,
      total_results: payload.total_results || 0,
    };
  }

  if (normalizedType === "upcoming") {
    const payload = await fetchTmdbCached("/movie/upcoming", { page: pageNumber, region: "US" }, ttlMs);
    const filteredResults = filterUpcomingResults(withMovieSource(payload.results, "upcoming", "/movie/upcoming"));

    if (filteredResults.length) {
      return {
        results: filteredResults,
        total_pages: payload.total_pages || 1,
        total_results: payload.total_results || 0,
      };
    }

    const fallbackPayload = await fetchTmdbCached(
      "/discover/movie",
      buildUpcomingDiscoverFallbackParams(pageNumber),
      ttlMs
    );

    return {
      results: filterUpcomingResults(withMovieSource(fallbackPayload.results, "upcoming", "/discover/movie")),
      total_pages: fallbackPayload.total_pages || payload.total_pages || 1,
      total_results: fallbackPayload.total_results || payload.total_results || 0,
    };
  }

  const payload = await fetchTmdbCached("/movie/now_playing", { page: pageNumber, region: "US" }, ttlMs);
  return {
    results: filterLatestResults(withMovieSource(payload.results, "now_playing", "/movie/now_playing")),
    total_pages: payload.total_pages || 1,
    total_results: payload.total_results || 0,
  };
};

const fetchDiscoverBatch = async (type, pageNumber, options = {}) => {
  const payload = await fetchTmdbCached(
    "/discover/movie",
    buildDiscoverParams(type, pageNumber, options),
    CACHE_TTLS.discover
  );

  return sortDiscoveryResults(type, withMovieSource(payload.results, "discover", "/discover/movie"));
};

const getMovieReleaseYear = (movie) => {
  const releaseYear = movie?.release_date ? new Date(movie.release_date).getFullYear() : null;
  return Number.isFinite(releaseYear) ? releaseYear : null;
};

const getMovieEraBucket = (movie) => {
  const year = getMovieReleaseYear(movie);

  if (!year) {
    return "unknown";
  }

  if (year >= 2020) {
    return "recent";
  }

  if (year >= 2010) {
    return "2010s";
  }

  if (year >= 2000) {
    return "2000s";
  }

  if (year >= 1990) {
    return "1990s";
  }

  return "older";
};

const getExposurePenalty = (movie) => {
  let penalty = 0;
  const normalizedTitle = String(movie?.title || "").trim().toLowerCase();
  const voteCount = movie?.vote_count || 0;
  const popularity = movie?.popularity || 0;
  const surfaceCount = pickSurfaceTally.get(movie?.id) || 0;

  if (OVEREXPOSED_PICK_TITLES.has(normalizedTitle)) {
    penalty += 18;
  }

  if (voteCount > 25000) {
    penalty += 16;
  } else if (voteCount > 15000) {
    penalty += 10;
  } else if (voteCount > 8000) {
    penalty += 5;
  }

  if (popularity > 180) {
    penalty += 10;
  } else if (popularity > 120) {
    penalty += 6;
  }

  if (surfaceCount >= 3) {
    penalty += 12;
  } else if (surfaceCount >= 2) {
    penalty += 8;
  } else if (surfaceCount >= 1) {
    penalty += 4;
  }

  const eraBucket = getMovieEraBucket(movie);
  if (eraBucket === "older") {
    penalty += 8;
  } else if (eraBucket === "1990s") {
    penalty += 4;
  }

  return penalty;
};

const getQualityFitBoost = (movie) => {
  let boost = 0;
  const voteAverage = movie?.vote_average || 0;
  const voteCount = movie?.vote_count || 0;
  const popularity = movie?.popularity || 0;
  const eraBucket = getMovieEraBucket(movie);

  if (voteAverage >= 6.5 && voteAverage <= 8.3) {
    boost += 10;
  } else if (voteAverage > 8.8) {
    boost -= 6;
  } else if (voteAverage < 6.2) {
    boost -= 10;
  }

  if (voteCount >= 120 && voteCount <= 8000) {
    boost += 8;
  }

  if (popularity >= 18 && popularity <= 110) {
    boost += 6;
  }

  if (eraBucket === "recent" || eraBucket === "2010s" || eraBucket === "2000s") {
    boost += 4;
  }

  return boost;
};

const balanceCandidatesByEra = (rankedCandidates = [], targetCount = 24) => {
  const buckets = {
    recent: [],
    "2010s": [],
    "2000s": [],
    "1990s": [],
    older: [],
    unknown: [],
  };

  rankedCandidates.forEach((entry) => {
    buckets[getMovieEraBucket(entry.movie)].push(entry);
  });

  const curated = [];
  const takeFromBucket = (bucketName, count) => {
    while (buckets[bucketName].length && count > 0) {
      curated.push(buckets[bucketName].shift());
      count -= 1;
    }
  };

  takeFromBucket("recent", 7);
  takeFromBucket("2010s", 6);
  takeFromBucket("2000s", 5);
  takeFromBucket("1990s", 3);
  takeFromBucket("older", 2);
  takeFromBucket("unknown", 2);

  const leftovers = Object.values(buckets).flat();
  leftovers.sort((left, right) => right.score - left.score);

  while (curated.length < targetCount && leftovers.length) {
    curated.push(leftovers.shift());
  }

  return curated.slice(0, targetCount);
};

const BEHAVIOR_LANE_GENRE_MAP = {
  light: [35, 10751, 16, 12, 10749],
  heavy: [18, 36, 10752, 80],
  dark: [27, 53, 80],
  funny: [35],
  emotional: [18, 10749, 10402, 16],
  easy_watch: [35, 10751, 16, 10749, 12],
  smart_twisty: [878, 9648, 53],
};

const BEHAVIOR_DEBUG_ENABLED = process.env.REELBOT_DEBUG_BEHAVIOR === "1";

const normalizeBehavioralMap = (value = {}, maxEntries = 12) =>
  Object.fromEntries(
    Object.entries(value && typeof value === "object" ? value : {})
      .map(([key, amount]) => [String(key), Number(amount || 0)])
      .filter(([, amount]) => Number.isFinite(amount) && amount > 0)
      .sort((left, right) => right[1] - left[1])
      .slice(0, maxEntries)
  );

const normalizeBehavioralIdSet = (values = []) =>
  new Set((Array.isArray(values) ? values : []).map((value) => Number.parseInt(value, 10)).filter(Boolean));

const getBehaviorRuntimeBucket = (runtime) => {
  const normalizedRuntime = Number(runtime || 0);

  if (!normalizedRuntime) {
    return "";
  }

  if (normalizedRuntime < 100) {
    return "short";
  }

  if (normalizedRuntime <= 130) {
    return "medium";
  }

  return "long";
};

const getBehaviorToneLanes = (movie = {}) =>
  Object.entries(BEHAVIOR_LANE_GENRE_MAP)
    .filter(([, genreIds]) => matchesAnyGenre(movie.genre_ids || [], genreIds))
    .map(([lane]) => lane);

const getBehaviorPaceLanes = (movie = {}) => {
  const genreIds = Array.isArray(movie.genre_ids) ? movie.genre_ids : [];
  const runtime = Number(movie.runtime || 0);

  if (matchesAnyGenre(genreIds, [28, 12, 53])) {
    return ["fast"];
  }

  if (matchesAnyGenre(genreIds, [18, 36, 99]) || runtime >= 135) {
    return ["slow"];
  }

  if (matchesAnyGenre(genreIds, [35, 10749, 16, 10751])) {
    return ["easy"];
  }

  return ["steady"];
};

const normalizeBehaviorUserProfile = (profile = {}) => ({
  likedGenres: Array.isArray(profile.likedGenres) ? profile.likedGenres.map((value) => Number.parseInt(value, 10)).filter(Boolean).slice(0, 5) : [],
  dislikedGenres: Array.isArray(profile.dislikedGenres) ? profile.dislikedGenres.map((value) => Number.parseInt(value, 10)).filter(Boolean).slice(0, 5) : [],
  preferredTraits: {
    pace: Array.isArray(profile.preferredTraits?.pace) ? profile.preferredTraits.pace.map((value) => String(value)).filter(Boolean).slice(0, 3) : [],
    tone: Array.isArray(profile.preferredTraits?.tone) ? profile.preferredTraits.tone.map((value) => String(value)).filter(Boolean).slice(0, 4) : [],
    runtime: Array.isArray(profile.preferredTraits?.runtime) ? profile.preferredTraits.runtime.map((value) => String(value)).filter(Boolean).slice(0, 2) : [],
  },
  avoidTraits: {
    pace: Array.isArray(profile.avoidTraits?.pace) ? profile.avoidTraits.pace.map((value) => String(value)).filter(Boolean).slice(0, 3) : [],
    tone: Array.isArray(profile.avoidTraits?.tone) ? profile.avoidTraits.tone.map((value) => String(value)).filter(Boolean).slice(0, 4) : [],
    runtime: Array.isArray(profile.avoidTraits?.runtime) ? profile.avoidTraits.runtime.map((value) => String(value)).filter(Boolean).slice(0, 2) : [],
  },
  recentlyViewed: Array.isArray(profile.recentlyViewed)
    ? profile.recentlyViewed.map((entry) => ({
        id: Number.parseInt(entry?.id, 10) || null,
        title: String(entry?.title || "").trim(),
      })).filter((entry) => entry.id || entry.title).slice(0, 6)
    : [],
  hardAvoidMovieIds: normalizeBehavioralIdSet(profile.hardAvoidMovieIds),
});

const normalizeBehavioralMemory = (memory = {}) => ({
  preferredGenres: normalizeBehavioralMap(memory.preferredGenres, 12),
  avoidedGenres: normalizeBehavioralMap(memory.avoidedGenres, 12),
  tonePreferences: normalizeBehavioralMap(memory.tonePreferences, 8),
  pacePreferences: normalizeBehavioralMap(memory.pacePreferences, 4),
  runtimePreference: normalizeBehavioralMap(memory.runtimePreference, 3),
  swapPatterns: {
    genres: normalizeBehavioralMap(memory.swapPatterns?.genres, 8),
    tones: normalizeBehavioralMap(memory.swapPatterns?.tones, 6),
    pace: normalizeBehavioralMap(memory.swapPatterns?.pace, 3),
    runtime: normalizeBehavioralMap(memory.swapPatterns?.runtime, 3),
  },
  recentPatterns: {
    genres: Array.isArray(memory.recentPatterns?.genres) ? memory.recentPatterns.genres.map((value) => Number.parseInt(value, 10)).filter(Boolean).slice(0, 4) : [],
    tones: Array.isArray(memory.recentPatterns?.tones) ? memory.recentPatterns.tones.map((value) => String(value)).filter(Boolean).slice(0, 4) : [],
    runtime: typeof memory.recentPatterns?.runtime === "string" ? memory.recentPatterns.runtime : "",
  },
  interactionStats: memory.interactionStats && typeof memory.interactionStats === "object" ? memory.interactionStats : {},
  hiddenMovieIds: normalizeBehavioralIdSet(memory.hiddenMovieIds),
  seenMovieIds: normalizeBehavioralIdSet(memory.seenMovieIds),
  savedMovieIds: normalizeBehavioralIdSet(memory.savedMovieIds),
  recentMovieIds: normalizeBehavioralIdSet(memory.recentMovieIds),
  userProfile: normalizeBehaviorUserProfile(memory.userProfile),
  updatedAt: typeof memory.updatedAt === "string" ? memory.updatedAt : "",
});

const getBehavioralMemoryCacheKey = (memory = {}) => {
  const normalizedMemory = normalizeBehavioralMemory(memory);

  return [
    Object.entries(normalizedMemory.preferredGenres).slice(0, 4).map(([key, value]) => `${key}:${Math.round(value)}`).join("|"),
    Object.entries(normalizedMemory.avoidedGenres).slice(0, 4).map(([key, value]) => `${key}:${Math.round(value)}`).join("|"),
    Object.entries(normalizedMemory.tonePreferences).slice(0, 3).map(([key, value]) => `${key}:${Math.round(value)}`).join("|"),
    Object.entries(normalizedMemory.pacePreferences).slice(0, 2).map(([key, value]) => `${key}:${Math.round(value)}`).join("|"),
    Object.entries(normalizedMemory.runtimePreference).slice(0, 2).map(([key, value]) => `${key}:${Math.round(value)}`).join("|"),
    `hidden:${normalizedMemory.hiddenMovieIds.size}`,
    `seen:${normalizedMemory.seenMovieIds.size}`,
    `updated:${normalizedMemory.updatedAt || "na"}`,
  ].join("::");
};

const getBehavioralMemoryScore = (movie = {}, memory = {}) => {
  const normalizedMemory = normalizeBehavioralMemory(memory);
  const movieId = Number(movie?.id || 0);
  const userProfile = normalizedMemory.userProfile;
  const paceLanes = getBehaviorPaceLanes(movie);
  const toneLanes = getBehaviorToneLanes(movie);
  const runtimeBucket = getBehaviorRuntimeBucket(movie.runtime);
  const swapCount = Number(normalizedMemory.interactionStats?.swaps || 0);
  const explorationFactor = swapCount >= 3 ? 0.82 : 1;

  if (normalizedMemory.hiddenMovieIds.has(movieId) || userProfile.hardAvoidMovieIds.has(movieId)) {
    return {
      score: -1000,
      reasons: ["hard_excluded"],
    };
  }

  const reasons = [];
  let score = 0;

  (movie.genre_ids || []).forEach((genreId) => {
    const preferredWeight = Number(normalizedMemory.preferredGenres[String(genreId)] || 0);
    const avoidedWeight = Number(normalizedMemory.avoidedGenres[String(genreId)] || 0);
    const swapWeight = Number(normalizedMemory.swapPatterns.genres[String(genreId)] || 0);

    if (preferredWeight) {
      score += preferredWeight * 1.12 * explorationFactor;
      reasons.push(`genre+${genreId}`);
    }

    if (avoidedWeight) {
      score -= avoidedWeight * 1.18 * explorationFactor;
      reasons.push(`genre-${genreId}`);
    }

    if (swapWeight) {
      score -= swapWeight * 0.85;
      reasons.push(`swap-genre-${genreId}`);
    }
  });

  toneLanes.forEach((lane) => {
    const toneWeight = Number(normalizedMemory.tonePreferences[lane] || 0);
    const swapWeight = Number(normalizedMemory.swapPatterns.tones[lane] || 0);
    const explicitTonePreference = userProfile.preferredTraits.tone.includes(lane);
    const explicitToneAvoid = userProfile.avoidTraits.tone.includes(lane);

    if (toneWeight) {
      score += toneWeight * 1.25 * explorationFactor;
      reasons.push(`tone+${lane}`);
    }

    if (swapWeight) {
      score -= swapWeight * 0.8;
      reasons.push(`swap-tone-${lane}`);
    }

    if (explicitTonePreference) {
      score += 4.9;
      reasons.push(`profile-tone+${lane}`);
    }

    if (explicitToneAvoid) {
      score -= 6;
      reasons.push(`profile-tone-${lane}`);
    }
  });

  paceLanes.forEach((lane) => {
    const paceWeight = Number(normalizedMemory.pacePreferences[lane] || 0);
    const swapWeight = Number(normalizedMemory.swapPatterns.pace[lane] || 0);
    const explicitPacePreference = userProfile.preferredTraits.pace.includes(lane);
    const explicitPaceAvoid = userProfile.avoidTraits.pace.includes(lane);

    if (paceWeight) {
      score += paceWeight * 1.05 * explorationFactor;
      reasons.push(`pace+${lane}`);
    }

    if (swapWeight) {
      score -= swapWeight * 0.65;
      reasons.push(`swap-pace-${lane}`);
    }

    if (explicitPacePreference) {
      score += 3.9;
      reasons.push(`profile-pace+${lane}`);
    }

    if (explicitPaceAvoid) {
      score -= 5;
      reasons.push(`profile-pace-${lane}`);
    }
  });

  if (runtimeBucket) {
    const runtimeWeight = Number(normalizedMemory.runtimePreference[runtimeBucket] || 0);
    const runtimeSwapWeight = Number(normalizedMemory.swapPatterns.runtime[runtimeBucket] || 0);
    const explicitRuntimePreference = userProfile.preferredTraits.runtime.includes(runtimeBucket);
    const explicitRuntimeAvoid = userProfile.avoidTraits.runtime.includes(runtimeBucket);

    if (runtimeWeight) {
      score += runtimeWeight * 0.85 * explorationFactor;
      reasons.push(`runtime+${runtimeBucket}`);
    }

    if (runtimeSwapWeight) {
      score -= runtimeSwapWeight * 0.65;
      reasons.push(`swap-runtime-${runtimeBucket}`);
    }

    if (explicitRuntimePreference) {
      score += 3.1;
      reasons.push(`profile-runtime+${runtimeBucket}`);
    }

    if (explicitRuntimeAvoid) {
      score -= 4.1;
      reasons.push(`profile-runtime-${runtimeBucket}`);
    }
  }

  if (userProfile.likedGenres.some((genreId) => (movie.genre_ids || []).includes(genreId))) {
    score += 5.4;
    reasons.push("profile-liked-genre");
  }

  if (userProfile.dislikedGenres.some((genreId) => (movie.genre_ids || []).includes(genreId))) {
    score -= 7.4;
    reasons.push("profile-disliked-genre");
  }

  if (normalizedMemory.recentPatterns.genres.some((genreId) => (movie.genre_ids || []).includes(genreId))) {
    score += 1.8;
    reasons.push("recent-genre");
  }

  if (normalizedMemory.recentPatterns.tones.some((lane) => toneLanes.includes(lane))) {
    score += 2.1;
    reasons.push("recent-tone");
  }

  if (normalizedMemory.recentPatterns.runtime && normalizedMemory.recentPatterns.runtime === runtimeBucket) {
    score += 1.2;
    reasons.push("recent-runtime");
  }

  if (normalizedMemory.savedMovieIds.has(movieId)) {
    score += 5.5;
    reasons.push("saved-positive");
  }

  if (normalizedMemory.seenMovieIds.has(movieId)) {
    score -= 12;
    reasons.push("seen-deprioritized");
  }

  if (normalizedMemory.recentMovieIds.has(movieId) || userProfile.recentlyViewed.some((entry) => entry.id === movieId)) {
    score -= 9;
    reasons.push("recently-viewed");
  }

  return {
    score: Math.max(-28, Math.min(28, Number(score.toFixed(2)))),
    reasons,
  };
};

const BEHAVIOR_TONE_REASON_LABELS = {
  light: "lighter",
  heavy: "heavier",
  dark: "darker",
  funny: "funnier",
  emotional: "more emotional",
  easy_watch: "easy-watch",
  smart_twisty: "smart, twisty",
};

const BEHAVIOR_PACE_REASON_LABELS = {
  fast: "faster-moving",
  slow: "slower-burn",
  easy: "easygoing",
  steady: "steady",
};

const BEHAVIOR_RUNTIME_REASON_LABELS = {
  short: "shorter",
  medium: "manageable",
  long: "longer sit-down",
};

const buildBehavioralPreferenceReason = (movie = {}, memory = {}) => {
  const normalizedMemory = normalizeBehavioralMemory(memory);
  const userProfile = normalizedMemory.userProfile;
  const genreIds = Array.isArray(movie.genre_ids) ? movie.genre_ids : [];
  const toneLanes = getBehaviorToneLanes(movie);
  const paceLanes = getBehaviorPaceLanes(movie);
  const runtimeBucket = getBehaviorRuntimeBucket(movie.runtime);

  const likedGenreId = userProfile.likedGenres.find((genreId) => genreIds.includes(genreId));
  if (likedGenreId && TMDB_MOVIE_GENRE_LOOKUP[likedGenreId]) {
    return `This stays close to the kinds of ${TMDB_MOVIE_GENRE_LOOKUP[likedGenreId].toLowerCase()} picks you've been saving.`;
  }

  const preferredTone = userProfile.preferredTraits.tone.find((lane) => toneLanes.includes(lane));
  if (preferredTone) {
    return `It leans toward the ${BEHAVIOR_TONE_REASON_LABELS[preferredTone] || preferredTone} lane you've been responding to best.`;
  }

  const preferredPace = userProfile.preferredTraits.pace.find((lane) => paceLanes.includes(lane));
  if (preferredPace) {
    return `It keeps the ${BEHAVIOR_PACE_REASON_LABELS[preferredPace] || preferredPace} feel you've been liking lately.`;
  }

  if (runtimeBucket && userProfile.preferredTraits.runtime.includes(runtimeBucket)) {
    return `The ${BEHAVIOR_RUNTIME_REASON_LABELS[runtimeBucket] || runtimeBucket} runtime also tracks with the nights you've been choosing lately.`;
  }

  const recentGenreId = normalizedMemory.recentPatterns.genres.find((genreId) => genreIds.includes(Number(genreId)));
  if (recentGenreId) {
    return "It stays near the lane you've been circling lately without just repeating the same title.";
  }

  return "";
};

const scorePickCandidate = (
  movie,
  preferences,
  promptBoosts = { personMovieIds: new Set(), titleSimilarMovieIds: new Set(), anchorMovieIds: new Set(), promptTokens: [] },
  intent = null,
  behavioralMemory = {}
) => {
  let score = (movie.vote_average || 0) * 10;
  score += Math.min(movie.vote_count || 0, 1800) / 38;
  score += Math.min(movie.popularity || 0, 800) / 48;
  score += Math.min(getMovieSignalScore(movie), 42) / 4;
  score += Math.min(movie.structured_match_score || 0, 220);
  score += getQualityFitBoost(movie);
  score -= getExposurePenalty(movie);
  score -= getMoodMismatchPenalty(movie, preferences);
  score -= getPromptTonePenalty(movie, preferences);

  if (isReleaseFeedMovie(movie)) {
    score += 7;
  }

  if (preferences.mood !== "all" && matchesAnyGenre(movie.genre_ids || [], PICK_MOOD_CONFIG[preferences.mood].genreIds)) {
    score += 16;
  }

  if (preferences.company !== "any" && matchesAnyGenre(movie.genre_ids || [], PICK_COMPANY_CONFIG[preferences.company].genreIds)) {
    score += 11;
  }

  if (preferences.genre !== "all" && matchesAnyGenre(movie.genre_ids || [], getGenreFilterIds(preferences.genre))) {
    score += 18;
  }

  if (preferences.runtime !== "any" && movie.runtime) {
    const runtimeConfig = PICK_RUNTIME_CONFIG[preferences.runtime];
    if (runtimeConfig.min && movie.runtime >= runtimeConfig.min) {
      score += 12;
    }
    if (runtimeConfig.max && movie.runtime <= runtimeConfig.max) {
      score += 12;
    }
    if (runtimeConfig.min && movie.runtime < runtimeConfig.min) {
      score -= 18;
    }
    if (runtimeConfig.max && movie.runtime > runtimeConfig.max) {
      score -= 18;
    }
  }

  if (preferences.prompt) {
    const promptSignals = getPromptSignals(preferences.prompt);
    const promptProfile = getPromptPreferenceProfile(preferences.prompt);

    if (promptSignals.mood && matchesAnyGenre(movie.genre_ids || [], PICK_MOOD_CONFIG[promptSignals.mood].genreIds)) {
      score += 8;
    }

    if (promptSignals.company && matchesAnyGenre(movie.genre_ids || [], PICK_COMPANY_CONFIG[promptSignals.company].genreIds)) {
      score += 6;
    }

    score += getPromptSpecificFitScore(movie, promptProfile);
    score += getIntentSpecificFitScore(movie, intent || parseReelbotIntent(preferences.prompt), promptBoosts);
  }

  if (preferences.view === "now_playing") {
    score += movie.release_date ? new Date(movie.release_date).getTime() / 1000000000000 : 0;
  }

  const releaseYear = getMovieReleaseYear(movie);
  if (releaseYear) {
    if (releaseYear >= 2015) {
      score += 4;
    } else if (releaseYear < 1990) {
      score -= 6;
    }
  }

  const behavioralResult = getBehavioralMemoryScore(movie, behavioralMemory);
  score += behavioralResult.score;

  return {
    score,
    behavioralAdjustment: behavioralResult.score,
    behavioralReasons: behavioralResult.reasons,
  };
};

const getPickMoodReason = (moodId) => {
  switch (moodId) {
    case "easy_watch":
      return "Easy to sink into without turning the night heavy";
    case "mind_bending":
      return "More idea-driven and satisfying than a generic thriller pick";
    case "dark":
      return "Keeps the intensity up without drifting into random shock value";
    case "funny":
      return "Light enough to keep the night moving instead of dragging";
    case "feel_something":
      return "Emotional in a rewarding way rather than purely draining";
    default:
      return "Feels like a strong overall fit for tonight";
  }
};

const getPickCompanyReason = (companyId) => {
  switch (companyId) {
    case "solo":
      return "Strong enough to hold attention on its own";
    case "pair":
      return "Works better as a shared watch than something too abrasive or niche";
    case "friends":
      return "Broad enough to play well with a room";
    default:
      return "Easy to say yes to without overthinking it";
  }
};

const getPickRuntimeReason = (runtimeId) => {
  switch (runtimeId) {
    case "under_two_hours":
      return "Fits the night cleanly without taking over the whole evening";
    case "over_two_hours":
      return "Has enough scale to justify settling in for a longer watch";
    default:
      return "Runtime should not be the thing that gets in the way";
  }
};

const joinReasonClauses = (clauses = []) => {
  const filteredClauses = clauses.filter(Boolean);

  if (!filteredClauses.length) {
    return "feels like a solid all-around pick for tonight";
  }

  if (filteredClauses.length === 1) {
    return filteredClauses[0];
  }

  if (filteredClauses.length === 2) {
    return `${filteredClauses[0]} and ${filteredClauses[1]}`;
  }

  return `${filteredClauses.slice(0, -1).join(", ")}, and ${filteredClauses[filteredClauses.length - 1]}`;
};

const buildPickReason = (movie, preferences) => {
  const genreNames = (movie.genre_ids || []).map((genreId) => TMDB_MOVIE_GENRE_LOOKUP[genreId]).filter(Boolean);
  const leadingGenres = genreNames.slice(0, 2).join(" / ");
  const promptProfile = getPromptPreferenceProfile(preferences.prompt);
  const parsedIntent = parseReelbotIntent(preferences.prompt);

  if (hasChildFamilyGuardrails(parsedIntent) && matchesAnyGenre(movie.genre_ids || [], [16, 10751, 35, 12, 14, 10402])) {
    return "It stays gentle, kid-friendly, and easy to settle into, which fits a comfort-watch lane better than something intense or demanding.";
  }

  if (promptProfile.visuallyStunning && matchesAnyGenre(movie.genre_ids || [], [878, 14, 12, 16, 36, 18, 28])) {
    return "Visual ambition is a real part of the appeal here, so it feels closer to a true spectacle pick than a generic fallback.";
  }

  if (promptProfile.tenseButNotMiserable && matchesAnyGenre(movie.genre_ids || [], [53, 9648, 28])) {
    return "It keeps real tension in the mix without leaning so bleak that it drains the night.";
  }

  if (promptProfile.easyWatch && matchesAnyGenre(movie.genre_ids || [], [35, 10749, 12, 16, 10751])) {
    return "The tone stays inviting, which makes it easier to throw on without overcommitting.";
  }

  if (promptProfile.smartTwisty && matchesAnyGenre(movie.genre_ids || [], [878, 9648, 53])) {
    return "It has enough ideas and turn-taking to feel sharper than a generic broad-appeal pick.";
  }

  if (promptProfile.dark && matchesAnyGenre(movie.genre_ids || [], [53, 80, 27])) {
    return "The darker tone feels intentional and atmospheric instead of edgy for its own sake.";
  }

  if (promptProfile.emotional && matchesAnyGenre(movie.genre_ids || [], [18, 10749, 10402, 16])) {
    return "The emotional pull feels earned, which gives it weight without flattening the experience.";
  }

  if ((movie.runtime || 0) > 0) {
    if (preferences.runtime === "under_two_hours" && movie.runtime <= 120) {
      return "Shorter runtime keeps the pacing easy to commit to.";
    }

    if (preferences.runtime === "over_two_hours" && movie.runtime >= 121) {
      return "Longer runtime gives the story room to build and land.";
    }
  }

  if ((movie.vote_average || 0) >= 7.4 && (movie.vote_count || 0) >= 80) {
    return "Strong audience response makes it feel like a safer bet than a blind swing.";
  }

  if ((movie.popularity || 0) >= 35 && isReleaseFeedMovie(movie)) {
    return "Release momentum suggests it is landing as one of the more relevant watches right now.";
  }

  if (leadingGenres) {
    return leadingGenres + " mix gives it a clear identity instead of feeling generic.";
  }

  return "Its tone and overall shape make it feel like a deliberate pick, not filler.";
};

const normalizePickMovie = (movie, preferences, overrides = {}) => ({
  id: movie.id,
  title: movie.title,
  overview: truncateText(movie.overview || "No description available.", 220),
  release_date: movie.release_date || "",
  vote_average: movie.vote_average || 0,
  poster_path: movie.poster_path || null,
  runtime: movie.runtime || null,
  genre_names: Array.isArray(movie.genre_names) ? movie.genre_names : [],
  signal_score: Number(getMovieSignalScore(movie).toFixed(1)),
  source_type: movie.source_type || "discover",
  source_endpoint: movie.source_endpoint || "/discover/movie",
  match_score: overrides.match_score || null,
  backupRole: overrides.backupRole || null,
  reason: overrides.reason || buildPickReason(movie, preferences),
});

const getPickCandidatePool = async (preferences, intent = null, promptBoosts = null) => {
  const discoverGenre = getPickGenreParam(preferences);
  const supportingView = normalizeDiscoveryView(preferences.view) === "popular" ? "now_playing" : "popular";

  const requestPlan = preferences.source === "library"
    ? [
        () => fetchFeedBatch(preferences.view, getRotatedPage(preferences.view, 0)),
        () => fetchFeedBatch(supportingView, getRotatedPage(supportingView, 1)),
        () => fetchDiscoverBatch(preferences.view, getRotatedPage("discover", 0), { runtime: preferences.runtime, genre: discoverGenre }),
        () => fetchDiscoverBatch(supportingView, getRotatedPage("discover", 1), { runtime: preferences.runtime, genre: discoverGenre }),
        () => fetchFeedBatch("now_playing", getRotatedPage("now_playing", 2)),
        () => fetchDiscoverBatch("popular", getRotatedPage("discover", 2), { runtime: preferences.runtime, genre: discoverGenre }),
      ]
    : [
        () => fetchFeedBatch(preferences.view, getRotatedPage(preferences.view, 0)),
        () => fetchDiscoverBatch(preferences.view, getRotatedPage("discover", 0), { runtime: preferences.runtime, genre: discoverGenre }),
        () => fetchFeedBatch(supportingView, getRotatedPage(supportingView, 1)),
        () => fetchDiscoverBatch(supportingView, getRotatedPage("discover", 1), { runtime: preferences.runtime, genre: discoverGenre }),
        () => fetchFeedBatch("now_playing", getRotatedPage("now_playing", 2)),
      ];

  const responses = await Promise.allSettled(requestPlan.map((request) => request()));
  const merged = responses
    .filter((response) => response.status === "fulfilled")
    .flatMap((response) => Array.isArray(response.value) ? response.value : response.value?.results || []);

  const entityKind = intent?.entity_anchor?.kind || null;
  const constrainedIds = entityKind === "actor"
    ? promptBoosts?.actorMovieIds
    : entityKind === "director"
      ? promptBoosts?.directorMovieIds
      : entityKind === "franchise"
        ? promptBoosts?.franchiseMovieIds
        : entityKind === "movie_title"
          ? promptBoosts?.constrainedAnchorMovieIds
          : null;
  const anchorIds = Array.from(new Set([
    ...(constrainedIds ? Array.from(constrainedIds) : []),
    ...(promptBoosts?.personMovieIds ? Array.from(promptBoosts.personMovieIds) : []),
    ...(promptBoosts?.titleSimilarMovieIds ? Array.from(promptBoosts.titleSimilarMovieIds) : []),
    ...(promptBoosts?.searchedMovieIds ? Array.from(promptBoosts.searchedMovieIds) : []),
  ])).slice(0, entityKind === "actor" || entityKind === "director" ? 40 : entityKind === "franchise" ? 28 : intent?.prompt_type === "title_similarity" ? 24 : 18);

  if (!anchorIds.length) {
    return dedupeMoviesById(merged).filter((movie) => !isLowSignalMovie(movie)).slice(0, 100);
  }

  const anchoredMovies = (await Promise.allSettled(anchorIds.map((movieId) => fetchTmdbCached(`/movie/${movieId}`, {}, CACHE_TTLS.movie_details))))
    .filter((response) => response.status === "fulfilled")
    .map((response) => ({
      ...response.value,
      genre_ids: Array.isArray(response.value.genres) ? response.value.genres.map((genre) => genre.id) : response.value.genre_ids || [],
      genre_names: Array.isArray(response.value.genres) ? response.value.genres.map((genre) => genre.name) : response.value.genre_names || [],
      source_type: entityKind === "actor" ? "actor_anchor" : entityKind === "director" ? "director_anchor" : entityKind === "franchise" ? "franchise_anchor" : entityKind === "movie_title" ? "title_anchor" : promptBoosts?.searchedMovieIds?.has(response.value.id) ? "prompt_search" : "discover",
      source_endpoint: entityKind === "actor" || entityKind === "director" ? "/person/movie_credits" : entityKind === "franchise" ? "/collection" : entityKind === "movie_title" ? "/movie/similar" : promptBoosts?.searchedMovieIds?.has(response.value.id) ? "/search/movie" : "/discover/movie",
    }));

  const isCourtroomLane = /courtroom|legal|trial|lawyer/i.test(String(intent?.normalized_prompt || ""));
  const baseMerged = entityKind === "actor" || entityKind === "director" || entityKind === "franchise"
    ? [...anchoredMovies]
    : isCourtroomLane
      ? [...anchoredMovies, ...merged.filter((movie) => /court|trial|lawyer|legal|attorney|judge|jury/i.test(String(movie.title || "") + " " + String(movie.overview || "")))]
      : intent?.prompt_type === "title_similarity"
        ? [...anchoredMovies, ...merged.filter((movie) => matchesAnyGenre(movie.genre_ids || [], promptBoosts?.anchorGenreIds || []))]
        : [...anchoredMovies, ...merged];

  return dedupeMoviesById(baseMerged).filter((movie) => !isLowSignalMovie(movie)).slice(0, 120);
};

const normalizeExcludedIds = (excludedIds = []) =>
  new Set(
    (Array.isArray(excludedIds) ? excludedIds : String(excludedIds || "").split(","))
      .map((value) => Number.parseInt(value, 10))
      .filter(Boolean)
  );

const fetchPickDetail = async (movieId) => {
  const payload = await fetchTmdbCached(`/movie/${movieId}`, {}, CACHE_TTLS.movie_details);
  return {
    id: payload.id,
    runtime: payload.runtime || null,
    genre_ids: Array.isArray(payload.genres) ? payload.genres.map((genre) => genre.id) : [],
    genre_names: Array.isArray(payload.genres) ? payload.genres.map((genre) => genre.name) : [],
    original_language: payload.original_language || "",
    production_countries: Array.isArray(payload.production_countries) ? payload.production_countries : [],
    production_country_codes: Array.isArray(payload.production_countries) ? payload.production_countries.map((country) => country.iso_3166_1).filter(Boolean) : [],
    spoken_languages: Array.isArray(payload.spoken_languages) ? payload.spoken_languages : [],
    spoken_language_codes: Array.isArray(payload.spoken_languages) ? payload.spoken_languages.map((language) => language.iso_639_1).filter(Boolean) : [],
    vote_average: payload.vote_average || 0,
    vote_count: payload.vote_count || 0,
    popularity: payload.popularity || 0,
    overview: payload.overview || "",
    signal_score: getMovieSignalScore(payload),
  };
};

const fetchMoviesByIds = async (movieIds = []) => {
  const ids = Array.from(new Set((Array.isArray(movieIds) ? movieIds : []).map((value) => Number.parseInt(value, 10)).filter(Boolean)));
  if (!ids.length) {
    return [];
  }

  const responses = await Promise.allSettled(ids.map((movieId) => fetchTmdbCached(`/movie/${movieId}`, {}, CACHE_TTLS.movie_details)));
  return responses
    .filter((response) => response.status === "fulfilled")
    .map((response) => ({
      ...response.value,
      genre_ids: Array.isArray(response.value.genres) ? response.value.genres.map((genre) => genre.id) : response.value.genre_ids || [],
      genre_names: Array.isArray(response.value.genres) ? response.value.genres.map((genre) => genre.name) : response.value.genre_names || [],
      source_type: response.value.source_type || "constrained_pool",
      source_endpoint: response.value.source_endpoint || "/movie",
    }));
};

const fetchStructuredMoviesByIds = async (movieIds = [], overrides = {}) => {
  const ids = Array.from(new Set((Array.isArray(movieIds) ? movieIds : []).map((value) => Number.parseInt(value, 10)).filter(Boolean)));
  if (!ids.length) {
    return [];
  }

  const responses = await Promise.allSettled(ids.map((movieId) => fetchTmdbCached(`/movie/${movieId}`, {}, CACHE_TTLS.movie_details)));
  return responses
    .filter((response) => response.status === "fulfilled")
    .map((response) => normalizeStructuredCandidate(response.value, overrides));
};

const resolveTmdbMovieByTitle = async (title = "") => {
  const query = String(title || "").trim();
  if (!query) {
    return null;
  }

  try {
    const payload = await fetchTmdb("/search/movie", { query, include_adult: "false", page: 1 });
    const movie = pickBestNamedResult(payload.results, query, "title");
    return movie?.id ? movie : null;
  } catch (error) {
    console.error("Error resolving TMDB movie by title:", error.response?.data || error.message);
    return null;
  }
};

const resolveTmdbKeywordIds = async (terms = []) => {
  const keywordEntries = [];

  for (const term of uniqueStrings(terms)) {
    try {
      const payload = await fetchTmdb("/search/keyword", { query: term, page: 1 });
      (payload.results || []).slice(0, 6).forEach((keyword) => {
        if (!keyword?.id || !keyword?.name) {
          return;
        }

        const keywordName = normalizeSearchText(keyword.name);
        const normalizedTerm = normalizeSearchText(term);
        let score = 0;
        if (keywordName === normalizedTerm) {
          score += 120;
        } else if (new RegExp(`\\b${escapeRegex(normalizedTerm)}\\b`, "i").test(keywordName)) {
          score += 70;
        } else if (keywordName.includes(normalizedTerm)) {
          score += 40;
        }

        keywordEntries.push({
          id: keyword.id,
          name: keyword.name,
          score,
        });
      });
    } catch (error) {
      console.error("Error resolving TMDB keywords:", error.response?.data || error.message);
    }
  }

  return keywordEntries
    .sort((left, right) => right.score - left.score)
    .filter((entry, index, list) => list.findIndex((candidate) => candidate.id === entry.id) === index)
    .slice(0, 6);
};

const scoreCountryCandidate = (movie = {}, structuredQuery = {}) => {
  const country = structuredQuery.country || {};
  const aliases = country.aliases || [];
  const locationTerms = country.location_terms || [];
  const combinedTerms = [...aliases, ...locationTerms, country.display_name];
  const searchableText = [movie.title, movie.overview, movie.tagline].filter(Boolean).join(" ");

  let score = 0;
  const reasons = [];

  if ((movie.production_country_codes || []).includes(country.iso_3166_1)) {
    score += 120;
    reasons.push("TMDB lists the target production country.");
  }

  if ((movie.spoken_language_codes || []).some((code) => (country.language_codes || []).includes(code))) {
    score += 28;
    reasons.push("Language metadata supports the country match.");
  }

  const textScore = getTextTermScore(searchableText, combinedTerms);
  if (textScore) {
    score += textScore;
    reasons.push("Title or overview mentions the country directly.");
  }

  const keywordScore = getTextTermScore((movie.structured_match_reasons || []).join(" "), aliases);
  if (keywordScore) {
    score += Math.round(keywordScore / 2);
    reasons.push("Matched TMDB keyword cues for the country.");
  }

  score += Math.min(movie.popularity || 0, 120) / 4;
  score += Math.min(movie.vote_count || 0, 500) / 20;
  score += (movie.vote_average || 0) * 3;

  return {
    score,
    reasons: uniqueStrings(reasons),
  };
};

const scoreGenreThemeCandidate = (movie = {}, structuredQuery = {}) => {
  const genreIds = Array.isArray(movie.genre_ids) ? movie.genre_ids : [];
  const expectedGenres = structuredQuery.genre_ids || [];
  const searchableText = [movie.title, movie.overview, movie.tagline].filter(Boolean).join(" ");
  const themeTerms = (structuredQuery.themes || []).flatMap((theme) => theme.keyword_terms || []);

  let score = 0;
  const reasons = [];

  if (expectedGenres.length && matchesAnyGenre(genreIds, expectedGenres)) {
    score += 90;
    reasons.push("TMDB genre tags match the requested lane.");
  }

  const textScore = getTextTermScore(searchableText, themeTerms);
  if (textScore) {
    score += textScore;
    reasons.push("Title or overview reinforces the requested theme.");
  }

  const keywordScore = getTextTermScore((movie.structured_match_reasons || []).join(" "), themeTerms);
  if (keywordScore) {
    score += Math.round(keywordScore / 2);
    reasons.push("Matched TMDB keyword cues for the theme.");
  }

  score += Math.min(movie.popularity || 0, 140) / 4;
  score += Math.min(movie.vote_count || 0, 600) / 18;
  score += (movie.vote_average || 0) * 3;

  return {
    score,
    reasons: uniqueStrings(reasons),
  };
};

const OSCAR_CATEGORY_HEADINGS = new Set([
  "Actor in a Leading Role",
  "Actor in a Supporting Role",
  "Actress in a Leading Role",
  "Actress in a Supporting Role",
  "Animated Feature Film",
  "Best Picture",
  "Cinematography",
  "Costume Design",
  "Directing",
  "Documentary Feature Film",
  "Film Editing",
  "International Feature Film",
  "Makeup and Hairstyling",
  "Music (Original Score)",
  "Music (Original Song)",
  "Production Design",
  "Sound",
  "Visual Effects",
  "Writing (Adapted Screenplay)",
  "Writing (Original Screenplay)",
]);

const OSCAR_SECOND_LINE_CATEGORIES = new Set([
  "Actor in a Leading Role",
  "Actor in a Supporting Role",
  "Actress in a Leading Role",
  "Actress in a Supporting Role",
  "Directing",
  "International Feature Film",
  "Music (Original Song)",
]);

const parseOscarTitlesFromHtml = (html = "") => {
  const lines = htmlToTextLines(html);
  const startIndex = lines.findIndex((line) => /winners?\s*&\s*nominees|nominees/i.test(line));
  const relevantLines = startIndex >= 0 ? lines.slice(startIndex + 1) : lines;
  const tallies = new Map();

  let currentCategory = "";
  let nominationBuffer = [];

  const flushBuffer = () => {
    if (!currentCategory || !nominationBuffer.length) {
      nominationBuffer = [];
      return;
    }

    const stride = OSCAR_SECOND_LINE_CATEGORIES.has(currentCategory) ? 2 : 1;

    for (let index = 0; index < nominationBuffer.length; index += stride) {
      let title = stride === 2 ? nominationBuffer[index + 1] : nominationBuffer[index];

      if (currentCategory === "Music (Original Song)" && /^from\s+/i.test(String(title || ""))) {
        title = String(title).replace(/^from\s+/i, "").split(/[;:-]/)[0].trim();
      }

      const normalizedTitle = sanitizeAwardTitle(title);
      if (!normalizedTitle || normalizedTitle.length < 2 || /^\d/.test(normalizedTitle)) {
        continue;
      }

      const current = tallies.get(normalizedTitle) || {
        title: normalizedTitle,
        nomination_count: 0,
        categories: [],
        score: 0,
      };

      current.nomination_count += 1;
      current.categories = uniqueStrings([...current.categories, currentCategory]);
      current.score += currentCategory === "Best Picture" ? 120 : 36;
      tallies.set(normalizedTitle, current);
    }

    nominationBuffer = [];
  };

  relevantLines.forEach((line) => {
    if (OSCAR_CATEGORY_HEADINGS.has(line)) {
      flushBuffer();
      currentCategory = line;
      return;
    }

    if (/^(winner|nominees?)$/i.test(line)) {
      flushBuffer();
      return;
    }

    if (!currentCategory) {
      return;
    }

    if (/^oscars death race podcast/i.test(line)) {
      flushBuffer();
      currentCategory = "";
      return;
    }

    nominationBuffer.push(line);
  });

  flushBuffer();

  return Array.from(tallies.values()).sort((left, right) => right.score - left.score || right.nomination_count - left.nomination_count);
};

const resolveCountryQueryCandidates = async (structuredQuery) => {
  const country = structuredQuery.country || {};
  const keywordTerms = uniqueStrings([country.display_name, ...(country.aliases || []), ...(country.location_terms || [])]);
  const keywordMatches = await resolveTmdbKeywordIds(keywordTerms);
  const candidateMap = new Map();

  const rememberCandidate = (movie = {}, metadata = {}) => {
    if (!movie?.id) {
      return;
    }

    const existing = candidateMap.get(movie.id) || normalizeStructuredCandidate(movie, {
      source_type: "country_search",
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
          source_type: "country_search",
          source_endpoint: metadata.source_endpoint || existing.source_endpoint || "/search/movie",
        }
      )
    );
  };

  for (const term of keywordTerms) {
    try {
      const payload = await fetchTmdb("/search/movie", { query: term, include_adult: "false", page: 1 });
      (payload.results || []).slice(0, 10).forEach((movie) => {
        rememberCandidate(movie, {
          source_endpoint: "/search/movie",
          match_reasons: [`TMDB search query matched "${term}".`],
        });
      });
    } catch (error) {
      console.error("Error fetching country search candidates:", error.response?.data || error.message);
    }
  }

  for (const keyword of keywordMatches) {
    try {
      const payload = await fetchTmdb("/discover/movie", {
        with_keywords: keyword.id,
        sort_by: "popularity.desc",
        include_adult: "false",
        page: 1,
      });
      (payload.results || []).slice(0, 12).forEach((movie) => {
        rememberCandidate(movie, {
          source_endpoint: "/discover/movie",
          match_reasons: [`TMDB keyword matched "${keyword.name}".`],
        });
      });
    } catch (error) {
      console.error("Error fetching country keyword candidates:", error.response?.data || error.message);
    }
  }

  const detailedCandidates = await fetchStructuredMoviesByIds(Array.from(candidateMap.keys()), {
    source_type: "country_search",
    source_endpoint: "/discover/movie",
  });

  return detailedCandidates
    .map((movie) => {
      const merged = normalizeStructuredCandidate({
        ...movie,
        structured_match_reasons: uniqueStrings([
          ...(movie.structured_match_reasons || []),
          ...((candidateMap.get(movie.id)?.structured_match_reasons) || []),
        ]),
      });
      const scored = scoreCountryCandidate(merged, structuredQuery);
      return normalizeStructuredCandidate(merged, {
        structured_match_score: scored.score,
        structured_match_reasons: scored.reasons.length ? scored.reasons : merged.structured_match_reasons,
      });
    })
    .filter((movie) => movie.structured_match_score >= 70)
    .sort((left, right) => right.structured_match_score - left.structured_match_score)
    .slice(0, 28);
};

const resolveGenreThemeCandidates = async (structuredQuery) => {
  const keywordTerms = uniqueStrings((structuredQuery.themes || []).flatMap((theme) => theme.keyword_terms || []));
  const keywordMatches = await resolveTmdbKeywordIds(keywordTerms);
  const discoverGenreIds = mergeGenreIds(structuredQuery.genre_ids, (structuredQuery.themes || []).flatMap((theme) => theme.genre_ids || []));
  const candidateMap = new Map();

  const rememberCandidate = (movie = {}, metadata = {}) => {
    if (!movie?.id) {
      return;
    }

    const existing = candidateMap.get(movie.id) || normalizeStructuredCandidate(movie, {
      source_type: "genre_theme_search",
      source_endpoint: metadata.source_endpoint || "/discover/movie",
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
          source_type: "genre_theme_search",
          source_endpoint: metadata.source_endpoint || existing.source_endpoint || "/discover/movie",
        }
      )
    );
  };

  if (discoverGenreIds.length) {
    try {
      const payload = await fetchTmdb("/discover/movie", {
        with_genres: discoverGenreIds.join(","),
        sort_by: "popularity.desc",
        include_adult: "false",
        page: 1,
      });
      (payload.results || []).slice(0, 18).forEach((movie) => {
        rememberCandidate(movie, {
          source_endpoint: "/discover/movie",
          match_reasons: ["TMDB genre filters matched the request."],
        });
      });
    } catch (error) {
      console.error("Error fetching genre-theme discover candidates:", error.response?.data || error.message);
    }
  }

  for (const keyword of keywordMatches) {
    try {
      const payload = await fetchTmdb("/discover/movie", {
        with_keywords: keyword.id,
        with_genres: discoverGenreIds.length ? discoverGenreIds.join(",") : undefined,
        sort_by: "popularity.desc",
        include_adult: "false",
        page: 1,
      });
      (payload.results || []).slice(0, 14).forEach((movie) => {
        rememberCandidate(movie, {
          source_endpoint: "/discover/movie",
          match_reasons: [`TMDB keyword matched "${keyword.name}".`],
        });
      });
    } catch (error) {
      console.error("Error fetching genre-theme keyword candidates:", error.response?.data || error.message);
    }
  }

  const detailedCandidates = await fetchStructuredMoviesByIds(Array.from(candidateMap.keys()), {
    source_type: "genre_theme_search",
    source_endpoint: "/discover/movie",
  });

  return detailedCandidates
    .map((movie) => {
      const merged = normalizeStructuredCandidate({
        ...movie,
        structured_match_reasons: uniqueStrings([
          ...(movie.structured_match_reasons || []),
          ...((candidateMap.get(movie.id)?.structured_match_reasons) || []),
        ]),
      });
      const scored = scoreGenreThemeCandidate(merged, structuredQuery);
      return normalizeStructuredCandidate(merged, {
        structured_match_score: scored.score,
        structured_match_reasons: scored.reasons.length ? scored.reasons : merged.structured_match_reasons,
      });
    })
    .filter((movie) => movie.structured_match_score >= 65)
    .sort((left, right) => right.structured_match_score - left.structured_match_score)
    .slice(0, 28);
};

const resolveAwardsCandidates = async (structuredQuery) => {
  try {
    const response = await axios.get(`https://www.oscars.org/oscars/ceremonies/${structuredQuery.year}`, {
      timeout: 8000,
      headers: {
        "User-Agent": "ReelBot/1.0",
      },
    });

    const tallies = parseOscarTitlesFromHtml(response.data).slice(0, 40);
    const resolvedMovies = [];

    for (const tally of tallies) {
      const resolvedMovie = await resolveTmdbMovieByTitle(tally.title);
      if (!resolvedMovie?.id) {
        continue;
      }

      resolvedMovies.push({
        ...resolvedMovie,
        structured_match_score: tally.score + tally.nomination_count * 10,
        structured_match_reasons: uniqueStrings([
          `Academy Awards ${structuredQuery.year} nominee list matched "${tally.title}".`,
          ...(tally.categories.includes("Best Picture") ? ["Best Picture nomination carries extra weight."] : []),
        ]),
        source_type: "awards_search",
        source_endpoint: "/search/movie",
      });
    }

    return uniqueMoviesById(resolvedMovies).slice(0, 28);
  } catch (error) {
    console.error("Error resolving Oscar candidates:", error.response?.data || error.message);
    return [];
  }
};

const resolveStructuredQueryCandidates = async (prompt = "") => {
  const structuredQuery = detectStructuredQuery(prompt);

  if (!structuredQuery) {
    return null;
  }

  if (structuredQuery.type === "awards") {
    const movies = await resolveAwardsCandidates(structuredQuery);
    return { structuredQuery, movies };
  }

  if (structuredQuery.type === "country") {
    const movies = await resolveCountryQueryCandidates(structuredQuery);
    return { structuredQuery, movies };
  }

  if (structuredQuery.type === "genre_theme") {
    const movies = await resolveGenreThemeCandidates(structuredQuery);
    return { structuredQuery, movies };
  }

  return null;
};

const enrichCandidatesWithDetails = async (movies = []) => {
  const responses = await Promise.allSettled(movies.map((movie) => fetchPickDetail(movie.id)));

  return movies.map((movie, index) => {
    const detailResponse = responses[index];
    if (detailResponse.status !== "fulfilled") {
      return movie;
    }

    return {
      ...movie,
      ...detailResponse.value,
      genre_ids: detailResponse.value.genre_ids.length ? detailResponse.value.genre_ids : movie.genre_ids,
      overview: detailResponse.value.overview || movie.overview,
    };
  });
};

const buildCompactCandidate = (movie) => ({
  id: movie.id,
  title: movie.title,
  release_year: movie.release_date ? new Date(movie.release_date).getFullYear() : null,
  era_bucket: getMovieEraBucket(movie),
  runtime: movie.runtime || null,
  genres: Array.isArray(movie.genre_names) ? movie.genre_names : [],
  vote_average: Number((movie.vote_average || 0).toFixed(1)),
  popularity: Math.round(movie.popularity || 0),
  vote_count: movie.vote_count || 0,
  signal_score: Number(getMovieSignalScore(movie).toFixed(1)),
  production_countries: Array.isArray(movie.production_countries) ? movie.production_countries : [],
  spoken_language_codes: Array.isArray(movie.spoken_language_codes) ? movie.spoken_language_codes : [],
  structured_match_score: movie.structured_match_score || 0,
  structured_match_reasons: Array.isArray(movie.structured_match_reasons) ? movie.structured_match_reasons : [],
  source_type: movie.source_type || "discover",
  overview: truncateText(movie.overview || "", 180),
});

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

const callStructuredOpenAI = async ({ systemPrompt, userPrompt, schema, schemaName, maxTokens = 420 }) => {
  if (!OPENAI_API_KEY) {
    return null;
  }

  const response = await axios.post(
    "https://api.openai.com/v1/responses",
    {
      model: OPENAI_MODEL,
      input: buildResponsesInput(systemPrompt, userPrompt),
      max_output_tokens: maxTokens,
      store: false,
      reasoning: { effort: isGpt5FamilyModel ? "minimal" : undefined },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  return safeJsonParse(extractResponsesText(response.data));
};

const BACKUP_ROLE_LABELS = {
  safer_option: "Safer option",
  lighter_option: "Lighter option",
  darker_option: "Darker option",
  wildcard: "Wildcard",
  stretch_option: "Stretch option",
  more_action_forward: "More action-forward",
  more_demanding: "More demanding",
  similar_tone: "Similar tone",
};

const normalizeAiCopy = (value = "") => String(value || "").replace(/\s+/g, " ").trim();

const isWeakAiCopy = (value = "") => {
  const normalizedValue = normalizeAiCopy(value).toLowerCase();
  if (!normalizedValue) {
    return true;
  }

  return REELBOT_BANNED_PHRASES.some((phrase) => normalizedValue.includes(phrase));
};

const getBackupRoleLabelFromKey = (roleKey = "similar_tone") => BACKUP_ROLE_LABELS[roleKey] || "Another angle";

const buildPromptContextLine = (intent = {}, preferences = {}) => {
  if (intent.refinement?.id === "lighter") {
    return "Staying in the same lane, but easing the weight so the next option feels simpler to settle into.";
  }

  if (intent.refinement?.id === "darker") {
    return "Keeping the same lane, but pushing it into a moodier and heavier direction.";
  }

  if (intent.refinement?.id === "shorter") {
    return "Keeping the same lane, but tightening the commitment so this feels easier to fit into the night.";
  }

  if (intent.refinement?.id === "funnier") {
    return "Keeping the core vibe, but looking for more lift and comic relief this time.";
  }

  if (intent.refinement?.id === "less_intense") {
    return "Staying close to the original ask, but softening the pressure and intensity.";
  }

  if (intent.refinement?.id === "more_like_this") {
    return "Staying right next to the last pick instead of restarting from a different idea.";
  }

  if (intent.refinement?.id === "different_angle") {
    return "Keeping the lane intact, but taking a nearby angle instead of repeating the same answer.";
  }

  if (intent.query_type === "COUNTRY" && intent.structured_query?.country?.display_name) {
    return `These picks stay genuinely tied to ${intent.structured_query.country.display_name} in setting, perspective, or story, rather than drifting into loose overlap.`;
  }

  if (intent.query_type === "AWARDS" && intent.structured_query?.year) {
    return `These picks stay focused on Oscars ${intent.structured_query.year} relevance first, then start with the strongest watch from that lane.`;
  }

  if (intent.query_type === "GENRE_THEME") {
    return "These picks stay close to the specific lane you asked for instead of drifting broader.";
  }

  if (intent.entity_anchor?.kind === "actor" || intent.entity_anchor?.kind === "director") {
    return `Staying close to ${intent.entity_anchor.name}, but still choosing the strongest watch for this moment.`;
  }

  if (intent.entity_anchor?.kind === "franchise") {
    return `Keeping the ${intent.entity_anchor.name} franchise feel intact while looking for the best option.`;
  }

  if (intent.entity_anchor?.kind === "movie_title" || intent.anchors?.title) {
    return `Keeping close to ${(intent.entity_anchor?.name || intent.anchors?.title)} without just repeating it.`;
  }

  if (intent.guardrails?.child_family_safe) {
    return "This stays in a gentler lane so it is easier to throw on without worrying about anything distressing or intense.";
  }

  if (intent.attention_profile?.level === "background") {
    return "This stays easy to live with in the room, so it does not ask for full locked-in attention.";
  }

  if (intent.attention_profile?.level === "immersive") {
    return "This leans toward a fuller sit-down watch instead of something disposable.";
  }

  if (preferences.prompt) {
    return `${truncateText(preferences.prompt.trim(), 72)} — read for the moment behind the ask, not just the surface keywords.`;
  }

  return "A sharper first pass from the current candidate pool.";
};

const buildFallbackPickSummaryLine = (movie, intent = {}) => {
  if (intent.guardrails?.child_family_safe) {
    return `${movie.title} feels safer, gentler, and easier to put on in this context than a pick that would add stress or intensity.`;
  }

  if (intent.query_type === "COUNTRY" && intent.structured_query?.country?.display_name) {
    return `${movie.title} stays genuinely connected to ${intent.structured_query.country.display_name} instead of only matching the prompt loosely.`;
  }

  if (intent.query_type === "AWARDS" && intent.structured_query?.year) {
    return `${movie.title} stays inside the Oscars ${intent.structured_query.year} lane while still feeling like a real watch choice, not just a nominee list entry.`;
  }

  if ((movie.structured_match_reasons || []).length) {
    return `${movie.title} rose to the top because it stays close to what you asked for instead of just feeling vaguely similar.`;
  }

  const genreNames = Array.isArray(movie.genre_names) ? movie.genre_names : [];
  const genreText = genreNames.slice(0, 2).join(" / ");
  if (genreText && movie.runtime) {
    return `${movie.title} is a ${genreText.toLowerCase()} pick with enough shape to justify ${movie.runtime} minutes.`;
  }

  if (movie.runtime) {
    return `${movie.title} has a clear enough identity to earn a ${movie.runtime}-minute commitment.`;
  }

  return `${movie.title} feels specific enough to choose on purpose instead of defaulting to something broader.`;
};

const buildFallbackWhyThisWorks = (movie, preferences, intent = {}, behavioralMemory = {}) => {
  const personalizationLine = buildBehavioralPreferenceReason(movie, behavioralMemory);
  const bullets = [
    buildPickReason(movie, preferences),
  ];

  if (personalizationLine) {
    bullets.unshift(personalizationLine);
  }

  if (intent.guardrails?.child_family_safe) {
    bullets.unshift("It stays in a gentler, lower-stress lane, which matters more here than edge or intensity.");
  } else if (intent.attention_profile?.level === "background") {
    bullets.unshift("It is easier to settle into without needing full locked-in attention.");
  } else if (intent.attention_profile?.level === "immersive") {
    bullets.unshift("It feels more like a real sit-down watch than background filler.");
  } else if (Array.isArray(movie.structured_match_reasons) && movie.structured_match_reasons.length) {
    bullets.unshift(movie.structured_match_reasons[0]);
  }

  if ((movie.runtime || 0) > 0) {
    bullets.push(movie.runtime <= 115 ? "Lean runtime keeps the commitment manageable." : movie.runtime >= 140 ? "Longer runtime suggests a fuller sit-down watch rather than background viewing." : "Runtime lands in a comfortable middle." );
  }

  if ((movie.vote_average || 0) >= 7.4 && (movie.vote_count || 0) >= 80) {
    bullets.push("Audience response adds confidence without making it feel like an obvious default.");
  }

  return bullets.map((item) => normalizeAiCopy(item)).filter(Boolean).slice(0, 2);
};

const buildFallbackBackupReason = (movie, roleKey, preferences, intent = {}) => {
  const reason = buildPickReason(movie, preferences);

  switch (roleKey) {
    case "safer_option":
      return `Broader and easier to say yes to, while staying close to the same vibe. ${reason}`;
    case "stretch_option":
      return `Still tracks the same intent, but pushes slightly outside the safest version of it. ${reason}`;
    case "lighter_option":
      return `Keeps more air in the experience if you want less weight. ${reason}`;
    case "darker_option":
      return `Pushes the mood further without leaving the original vibe. ${reason}`;
    case "more_action_forward":
      return `A better move if you want the same vibe with more propulsion. ${reason}`;
    case "more_demanding":
      return `Asks for a little more patience, but pays it back with specificity. ${reason}`;
    case "wildcard":
      return `The less obvious option that still tracks the same intent. ${reason}`;
    default:
      return `Keeps the same core appeal from a slightly different angle. ${reason}`;
  }
};

const buildFallbackPickPresentation = (preferences, intent, primaryMovie, backups = [], rankedBackups = [], behavioralMemory = {}) => {
  const backupEntries = backups.map((movie, index) => {
    const roleKey = rankedBackups[index]?.role_key
      || (preferences.request_mode === "swap"
        ? (index === 0 ? "safer_option" : index === 1 ? "stretch_option" : index === 2 ? "wildcard" : "similar_tone")
        : (index === 0 ? "safer_option" : index === 1 ? "lighter_option" : index === 2 ? "darker_option" : "wildcard"));
    return {
      id: movie.id,
      role_label: getBackupRoleLabelFromKey(roleKey),
      reason: buildFallbackBackupReason(movie, roleKey, preferences, intent),
    };
  });

  return {
    context_line: buildPromptContextLine(intent, preferences),
    summary_line: buildFallbackPickSummaryLine(primaryMovie, intent),
    why_this_works: buildFallbackWhyThisWorks(primaryMovie, preferences, intent, behavioralMemory),
    assistant_note: "ReelBot kept the same intent lane, then widened the surrounding options on purpose.",
    primary_reason: buildPickReason(primaryMovie, preferences),
    backups: backupEntries,
  };
};

const rankCandidatesWithOpenAI = async (preferences, intent, candidates) => {
  if (!OPENAI_API_KEY || !candidates.length) {
    return null;
  }

  const prompts = buildPickRankerPrompts({
    preferences,
    intent,
    candidates: candidates.map((movie) => buildCompactCandidate(movie)),
  });

  return callStructuredOpenAI({
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    schema: pickRankingSchema,
    schemaName: "reelbot_pick_ranking_v2",
    maxTokens: 420,
    temperature: 0.25,
  });
};

const writePickPresentationWithOpenAI = async (preferences, intent, primaryMovie, backups = [], rankedBackups = [], behavioralMemory = {}) => {
  if (!OPENAI_API_KEY || !primaryMovie || backups.length < 4) {
    return null;
  }

  const prompts = buildPickWriterPrompts({
    preferences,
    intent,
    primary: buildCompactCandidate(primaryMovie),
    backups: backups.map((movie, index) => ({
      ...buildCompactCandidate(movie),
      role_key: rankedBackups[index]?.role_key || null,
    })),
  });

  const payload = await callStructuredOpenAI({
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    schema: pickWriterSchema,
    schemaName: "reelbot_pick_writer_v2",
    maxTokens: 360,
    temperature: 0.45,
  });

  if (!payload) {
    return null;
  }

  payload.context_line = isWeakAiCopy(payload.context_line) ? buildPromptContextLine(intent, preferences) : payload.context_line;
  payload.summary_line = isWeakAiCopy(payload.summary_line) ? buildFallbackPickSummaryLine(primaryMovie, intent) : payload.summary_line;
  payload.primary_reason = isWeakAiCopy(payload.primary_reason) ? buildPickReason(primaryMovie, preferences) : payload.primary_reason;
  payload.why_this_works = Array.isArray(payload.why_this_works)
    ? payload.why_this_works.map((item) => normalizeAiCopy(item)).filter((item) => item && !isWeakAiCopy(item)).slice(0, 2)
    : [];

  if (payload.why_this_works.length < 2) {
    payload.why_this_works = buildFallbackWhyThisWorks(primaryMovie, preferences, intent, behavioralMemory);
  }

  const personalizationLine = buildBehavioralPreferenceReason(primaryMovie, behavioralMemory);
  if (personalizationLine) {
    payload.why_this_works = [personalizationLine, ...payload.why_this_works]
      .map((item) => normalizeAiCopy(item))
      .filter((item, index, items) => item && items.indexOf(item) === index)
      .slice(0, 2);
  }

  payload.backups = Array.isArray(payload.backups)
    ? payload.backups.map((entry, index) => ({
        id: entry.id,
        role_label: normalizeAiCopy(entry.role_label) || getBackupRoleLabelFromKey(rankedBackups[index]?.role_key),
        reason: isWeakAiCopy(entry.reason) ? buildFallbackBackupReason(backups[index], rankedBackups[index]?.role_key, preferences, intent) : normalizeAiCopy(entry.reason),
      }))
    : [];

  return payload;
};

const buildMatchScore = (score, topScore) => {
  if (!topScore) {
    return 78;
  }

  const relativeGap = Math.max(0, topScore - score);
  return Math.max(68, Math.min(96, Math.round(94 - (relativeGap / Math.max(topScore, 1)) * 28)));
};

const generatePickPayload = async (rawPreferences = {}) => {
  const preferences = resolvePickPreferences(rawPreferences);
  const behavioralMemory = normalizeBehavioralMemory(rawPreferences.behavioral_memory);
  const refinement = normalizePickRefinement(rawPreferences.refinement);
  let resolvedIntent = await hydrateResolvedIntent(preferences, rawPreferences);
  const structuredResolution = preferences.prompt ? await resolveStructuredQueryCandidates(preferences.prompt) : null;

  if (structuredResolution?.structuredQuery) {
    const baseLaneKey =
      structuredResolution.structuredQuery.type === "country"
        ? `country:${structuredResolution.structuredQuery.country.canonical}`
        : structuredResolution.structuredQuery.type === "awards"
          ? `awards:oscars:${structuredResolution.structuredQuery.year}`
          : `genre_theme:${normalizeSearchText(preferences.prompt)}`;
    resolvedIntent = {
      ...resolvedIntent,
      lane_key: refinement?.id ? `${baseLaneKey}:refine:${refinement.id}` : baseLaneKey,
      structured_query: {
        ...structuredResolution.structuredQuery,
        movie_ids: structuredResolution.movies.map((movie) => movie.id),
      },
      query_type:
        structuredResolution.structuredQuery.type === "country"
          ? "COUNTRY"
          : structuredResolution.structuredQuery.type === "awards"
            ? "AWARDS"
            : "GENRE_THEME",
    };
  }

  const queryType = resolvedIntent.query_type || getIntentQueryType(resolvedIntent);
  const excludedIds = normalizeExcludedIds(rawPreferences.excluded_ids);
  behavioralMemory.hiddenMovieIds.forEach((movieId) => excludedIds.add(movieId));
  if (preferences.request_mode !== "swap") {
    behavioralMemory.seenMovieIds.forEach((movieId) => excludedIds.add(movieId));
  }
  const refreshKey = rawPreferences.refresh_key ? String(rawPreferences.refresh_key) : "";
  const refinementSignature = refinement?.id ? `:refine:${refinement.id}` : "";
  const cacheKey = `pick:${preferences.source}:${preferences.view}:${preferences.genre}:${preferences.mood}:${preferences.runtime}:${preferences.company}:${preferences.prompt.toLowerCase()}:lane:${resolvedIntent.lane_key}${refinementSignature}:excluded:${Array.from(excludedIds).sort((left, right) => left - right).join(",")}:behavior:${getBehavioralMemoryCacheKey(behavioralMemory)}`;

  if (!refreshKey) {
    const cachedPayload = readCache(pickCache, cacheKey);
    if (cachedPayload) {
      return { ...cachedPayload, cached: true };
    }
  }

  const promptBoosts = await getPromptMovieBoosts(preferences.prompt, resolvedIntent);
  if (structuredResolution?.movies?.length) {
    promptBoosts.structuredMovieIds = new Set(structuredResolution.movies.map((movie) => movie.id));
  }
  const providedCandidatePoolIds = Array.isArray(rawPreferences.candidate_pool_ids)
    ? rawPreferences.candidate_pool_ids.map((value) => Number.parseInt(value, 10)).filter(Boolean)
    : [];
  const hasProvidedCandidatePool = providedCandidatePoolIds.length > 0;
  const usesHardEntityPool = ["PERSON", "DIRECTOR", "FRANCHISE", "TITLE_SIMILARITY", "COUNTRY", "AWARDS", "GENRE_THEME"].includes(queryType);

  const candidatePool = hasProvidedCandidatePool
    ? await fetchMoviesByIds(providedCandidatePoolIds)
    : structuredResolution
      ? structuredResolution.movies
      : await getPickCandidatePool(preferences, resolvedIntent, promptBoosts);
  const fallbackPool = !candidatePool.length && !usesHardEntityPool && (preferences.mood !== "all" || preferences.runtime !== "any")
    ? await getPickCandidatePool({ ...preferences, mood: "all", runtime: "any" }, resolvedIntent, promptBoosts)
    : candidatePool;

  const locallyFilteredPool = fallbackPool.filter((movie) => !excludedIds.has(movie.id) && !isLowSignalMovie(movie));
  const intentFilteredPool = locallyFilteredPool.filter((movie) => isMovieValidForIntent(movie, resolvedIntent, promptBoosts));
  const baseRankingPool = intentFilteredPool.length ? intentFilteredPool : locallyFilteredPool;
  const preliminaryRanked = dedupeMoviesById(baseRankingPool)
    .map((movie) => {
      const scoring = scorePickCandidate(movie, preferences, promptBoosts, resolvedIntent, behavioralMemory);
      return {
        movie,
        score: scoring.score,
        behavioral_adjustment: scoring.behavioralAdjustment,
        behavioral_reasons: scoring.behavioralReasons,
      };
    })
    .sort((left, right) => right.score - left.score);

  const topPreliminaryCandidates = preliminaryRanked.slice(0, 36).map((entry) => entry.movie);
  const detailedCandidates = await enrichCandidatesWithDetails(topPreliminaryCandidates);
  const finalRankedCandidates = detailedCandidates
    .filter((movie) => !isLowSignalMovie(movie) && !excludedIds.has(movie.id))
    .map((movie) => {
      const scoring = scorePickCandidate(movie, preferences, promptBoosts, resolvedIntent, behavioralMemory);
      return {
        movie,
        score: scoring.score,
        behavioral_adjustment: scoring.behavioralAdjustment,
        behavioral_reasons: scoring.behavioralReasons,
      };
    })
    .sort((left, right) => right.score - left.score);

  const validatedRankedCandidates = finalRankedCandidates.filter((entry) => isMovieValidForIntent(entry.movie, resolvedIntent, promptBoosts));
  const rankingSourceEntries = usesHardEntityPool ? validatedRankedCandidates : finalRankedCandidates;
  const curatedRankingEntries = usesHardEntityPool
    ? rankingSourceEntries.slice(0, Math.max(8, Math.min(rankingSourceEntries.length, 40)))
    : balanceCandidatesByEra(rankingSourceEntries, 22);
  const rankingPool = curatedRankingEntries.map((entry) => entry.movie);
  if (BEHAVIOR_DEBUG_ENABLED) {
    console.log(
      "[ReelBot behavioral memory]",
      curatedRankingEntries
        .filter((entry) => entry.behavioral_adjustment)
        .slice(0, 6)
        .map((entry) => ({
          title: entry.movie?.title,
          score: Number(entry.score.toFixed(2)),
          behavioral_adjustment: entry.behavioral_adjustment,
          behavioral_reasons: entry.behavioral_reasons,
        }))
    );
  }
  const aiRanking = rankingPool.length >= 5 ? await rankCandidatesWithOpenAI(preferences, resolvedIntent, rankingPool).catch((error) => {
    console.error("OpenAI ranking failed:", error.response?.data || error.message);
    return null;
  }) : null;

  const movieLookup = new Map(rankingPool.map((movie) => [movie.id, movie]));
  const fallbackPrimary = rankingSourceEntries[0]?.movie || null;
  const fallbackBackups = rankingSourceEntries.slice(1, 5).map((entry) => entry.movie);

  const rankedPrimaryCandidate = movieLookup.get(aiRanking?.primary?.id);
  const primaryPick = rankedPrimaryCandidate && isMovieValidForIntent(rankedPrimaryCandidate, resolvedIntent, promptBoosts)
    ? rankedPrimaryCandidate
    : fallbackPrimary;
  const alternatePicks = (Array.isArray(aiRanking?.backups) ? aiRanking.backups.map((entry) => movieLookup.get(entry.id)).filter(Boolean) : fallbackBackups)
    .filter((movie) => movie?.id && movie.id !== primaryPick?.id && isMovieValidForIntent(movie, resolvedIntent, promptBoosts))
    .slice(0, 4);

  if (!primaryPick) {
    return {
      label: "Pick for Me",
      summary: buildPickNoMatchSummary(preferences),
      assistant_note: usesHardEntityPool
        ? "ReelBot stayed inside the anchored candidate set and could not find a strong enough valid result."
        : "ReelBot could not find a strong-enough fit from the current candidate pool.",
      resolved_preferences: preferences,
      resolved_intent: resolvedIntent,
      validation: {
        query_type: queryType,
        hard_lock_applied: usesHardEntityPool,
        primary_valid: false,
        alternates_valid: true,
      },
      candidate_pool_ids: rankingPool.map((movie) => movie.id),
      primary: null,
      alternates: [],
      resolved_refinement: refinement,
      debug_trace: {
        prompt: preferences.prompt,
        refinement,
        parsed_intent: resolvedIntent,
        applied_constraints: summarizeAppliedConstraints(resolvedIntent, refinement),
        ranked_candidates: rankingSourceEntries.slice(0, 8).map((entry) => ({
          id: entry.movie.id,
          title: entry.movie.title,
          score: Number(entry.score.toFixed(2)),
        })),
      },
      cached: false,
    };
  }

  const topScore = rankingSourceEntries[0]?.score || 0;
  const rankedBackups = Array.isArray(aiRanking?.backups)
    ? aiRanking.backups
        .filter((entry) => movieLookup.get(entry.id) && entry.id !== primaryPick.id && isMovieValidForIntent(movieLookup.get(entry.id), resolvedIntent, promptBoosts))
        .slice(0, 4)
    : alternatePicks.map((movie, index) => ({
        id: movie.id,
        fit_score: buildMatchScore(rankingSourceEntries.find((entry) => entry.movie.id === movie.id)?.score || topScore, topScore),
        role_key: preferences.request_mode === "swap"
          ? (index === 0 ? "safer_option" : index === 1 ? "stretch_option" : index === 2 ? "wildcard" : "similar_tone")
          : (index === 0 ? "safer_option" : index === 1 ? "lighter_option" : index === 2 ? "darker_option" : "wildcard"),
      }));

  const presentation = await writePickPresentationWithOpenAI(preferences, resolvedIntent, primaryPick, alternatePicks, rankedBackups, behavioralMemory).catch((error) => {
    console.error("OpenAI pick writer failed:", error.response?.data || error.message);
    return null;
  }) || buildFallbackPickPresentation(preferences, resolvedIntent, primaryPick, alternatePicks, rankedBackups, behavioralMemory);

  const backupPresentationLookup = new Map((presentation.backups || []).map((entry) => [entry.id, entry]));
  const primaryRankingEntry = rankingSourceEntries.find((entry) => entry.movie.id === primaryPick.id) || null;
  const debugTrace = {
    prompt: preferences.prompt,
    refinement,
    parsed_intent: resolvedIntent,
    applied_constraints: summarizeAppliedConstraints(resolvedIntent, refinement),
    ranked_candidates: rankingSourceEntries.slice(0, 8).map((entry) => ({
      id: entry.movie.id,
      title: entry.movie.title,
      score: Number(entry.score.toFixed(2)),
      behavioral_adjustment: entry.behavioral_adjustment,
      known_bad_pattern_adjustments: getKnownBadPatternAdjustments(entry.movie, resolvedIntent),
    })),
  };
  const payload = {
    label: "Pick for Me",
    summary: presentation.summary_line || buildPickSuccessSummary(primaryPick),
    assistant_note: presentation.assistant_note || "ReelBot ranked a fresh pool of candidates and kept the backups nearby without crowding the main choice.",
    match_score: aiRanking?.primary?.fit_score || buildMatchScore(rankingSourceEntries.find((entry) => entry.movie.id === primaryPick.id)?.score || topScore, topScore),
    resolved_preferences: preferences,
    resolved_intent: resolvedIntent,
    resolved_refinement: refinement,
    validation: {
      query_type: queryType,
      hard_lock_applied: usesHardEntityPool,
      primary_valid: isMovieValidForIntent(primaryPick, resolvedIntent, promptBoosts),
      alternates_valid: alternatePicks.every((movie) => isMovieValidForIntent(movie, resolvedIntent, promptBoosts)),
      behavioral_memory_applied: Boolean(
        Object.keys(behavioralMemory.preferredGenres).length ||
        Object.keys(behavioralMemory.avoidedGenres).length ||
        behavioralMemory.hiddenMovieIds.size ||
        behavioralMemory.seenMovieIds.size
      ),
    },
    candidate_pool_ids: rankingPool.map((movie) => movie.id),
    rationale: {
      heading: "ReelBot's Pick",
      contextAnchor: presentation.context_line,
      whyTitle: "Why ReelBot picked this",
      whyRecommended: presentation.why_this_works || [],
      summaryLine: presentation.summary_line,
      primary_reason: presentation.primary_reason,
      personalization_hint: buildBehavioralPreferenceReason(primaryPick, behavioralMemory) || null,
    },
    primary: normalizePickMovie(primaryPick, preferences, {
      reason: presentation.primary_reason,
      match_score: aiRanking?.primary?.fit_score || buildMatchScore(rankingSourceEntries.find((entry) => entry.movie.id === primaryPick.id)?.score || topScore, topScore),
    }),
    alternates: alternatePicks.map((movie, index) => normalizePickMovie(movie, preferences, {
      reason: backupPresentationLookup.get(movie.id)?.reason || buildFallbackBackupReason(movie, rankedBackups[index]?.role_key, preferences, resolvedIntent),
      backupRole: backupPresentationLookup.get(movie.id)?.role_label || getBackupRoleLabelFromKey(rankedBackups[index]?.role_key),
      match_score: buildMatchScore(rankingSourceEntries.find((entry) => entry.movie.id === movie.id)?.score || topScore, topScore),
    })),
    candidate_count: candidatePool.length,
    curated_candidate_count: rankingPool.length,
    debug_trace: {
      ...debugTrace,
      final_pick: {
        id: primaryPick.id,
        title: primaryPick.title,
        reason: presentation.primary_reason,
        behavioral_adjustment: primaryRankingEntry?.behavioral_adjustment || 0,
        behavioral_reasons: primaryRankingEntry?.behavioral_reasons || [],
      },
    },
  };

  [primaryPick, ...alternatePicks].filter(Boolean).forEach((movie) => {
    pickSurfaceTally.set(movie.id, (pickSurfaceTally.get(movie.id) || 0) + 1);
  });

  if (!refreshKey) {
    writeCache(pickCache, cacheKey, payload, CACHE_TTLS.pick);
  }

  return { ...payload, cached: false };
};

const pickTrailer = (videos = []) => {
  const safeVideos = Array.isArray(videos) ? videos : [];
  const trailer =
    safeVideos.find((video) => video?.site === "YouTube" && video?.type === "Trailer" && video?.official) ||
    safeVideos.find((video) => video?.site === "YouTube" && video?.type === "Trailer") ||
    safeVideos.find((video) => video?.site === "YouTube" && video?.type === "Teaser") ||
    safeVideos.find((video) => video?.site === "YouTube" && video?.type === "Clip") ||
    safeVideos.find((video) => video?.site === "YouTube");

  if (!trailer?.key) {
    return null;
  }

  return {
    name: trailer.name || "Trailer",
    site: trailer.site,
    type: trailer.type || "Video",
    key: trailer.key,
    official: Boolean(trailer.official),
    url: `https://www.youtube.com/watch?v=${trailer.key}`,
    embed_url: `https://www.youtube.com/embed/${trailer.key}?autoplay=1&rel=0&modestbranding=1`,
  };
};

const normalizeProviderList = (providers = [], accessType) =>
  Array.isArray(providers)
    ? providers.slice(0, 6).map((provider) => ({
        id: provider.provider_id,
        name: provider.provider_name,
        logo_path: provider.logo_path || null,
        access_type: accessType,
      }))
    : [];

const normalizeWatchProviders = (watchProviderPayload) => {
  const results = watchProviderPayload?.results || {};
  const region = results.US ? "US" : Object.keys(results)[0];

  if (!region) {
    return null;
  }

  const regionData = results[region] || {};

  return {
    region,
    link: regionData.link || "",
    subscription: normalizeProviderList(regionData.flatrate, "subscription"),
    rent: normalizeProviderList(regionData.rent, "rent"),
    buy: normalizeProviderList(regionData.buy, "buy"),
  };
};

const buildProviderBadges = (availability) => {
  if (!availability) {
    return [];
  }

  const seen = new Set();
  return [
    ...(Array.isArray(availability.subscription) ? availability.subscription : []),
    ...(Array.isArray(availability.rent) ? availability.rent : []),
    ...(Array.isArray(availability.buy) ? availability.buy : []),
  ]
    .filter((provider) => {
      if (!provider?.id || seen.has(provider.id)) {
        return false;
      }
      seen.add(provider.id);
      return true;
    })
    .slice(0, 3)
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      logo_path: provider.logo_path || null,
      access_type: provider.access_type || null,
    }));
};

const normalizeMovieDetails = (movie) => {
  const reviewHighlights = getReviewHighlights(movie.reviews?.results);

  return {
    id: movie.id,
    title: movie.title,
    tagline: movie.tagline || "",
    description: movie.overview || "No description available.",
    release_date: movie.release_date || "",
    release_year: movie.release_date ? new Date(movie.release_date).getFullYear() : null,
    runtime: movie.runtime || null,
    status: movie.status || "",
    director: getDirector(movie.credits),
    rating: movie.vote_average || 0,
    vote_count: movie.vote_count || 0,
    revenue: movie.revenue || 0,
    budget: movie.budget || 0,
    genres: Array.isArray(movie.genres) ? movie.genres : [],
    genre_names: Array.isArray(movie.genres) ? movie.genres.map((genre) => genre.name) : [],
    original_language: movie.original_language || "",
    spoken_languages: Array.isArray(movie.spoken_languages)
      ? movie.spoken_languages.map((language) => language.english_name)
      : [],
    production_countries: Array.isArray(movie.production_countries)
      ? movie.production_countries.map((country) => country.name)
      : [],
    top_cast: Array.isArray(movie.credits?.cast)
      ? movie.credits.cast.slice(0, 5).map((castMember) => castMember.name)
      : [],
    poster_path: movie.poster_path || null,
    backdrop_path: movie.backdrop_path || null,
    review_highlights: reviewHighlights,
    trailer: pickTrailer(movie.videos?.results),
    watch_providers: normalizeWatchProviders(movie["watch/providers"]),
    similar: Array.isArray(movie.similar?.results)
      ? movie.similar.results
          .filter((similarMovie) => similarMovie.poster_path)
          .sort((left, right) => (right.vote_count || 0) - (left.vote_count || 0) || (right.popularity || 0) - (left.popularity || 0))
          .slice(0, 6)
          .map((similarMovie) => ({
            id: similarMovie.id,
            title: similarMovie.title,
            release_date: similarMovie.release_date || "",
            poster_path: similarMovie.poster_path || null,
          }))
      : [],
  };
};

const normalizeAction = (action) => (REELBOT_ACTIONS[action] ? action : "quick_take");
const normalizeReelbotRequestMeta = (requestedAction, requestBody = {}) => {
  const action = normalizeAction(requestedAction);
  const spoilerActionSelected = SPOILER_ACTION_IDS.has(action);
  const spoilerMode = requestBody?.spoiler_mode === true;
  const useCase = typeof requestBody?.use_case === "string" && requestBody.use_case.trim() ? requestBody.use_case.trim() : action;
  const promptTemplate = typeof requestBody?.prompt_template === "string" && requestBody.prompt_template.trim()
    ? requestBody.prompt_template.trim()
    : spoilerActionSelected
      ? "detail_spoiler"
      : "detail_standard";

  return {
    spoiler_mode: spoilerMode,
    use_case: useCase,
    prompt_template: promptTemplate,
    user_prompt: typeof requestBody?.user_prompt === "string" ? requestBody.user_prompt.trim() : "",
    intent_snapshot: isIntentSnapshotValid(requestBody?.intent_snapshot) ? requestBody.intent_snapshot : null,
    behavioral_memory: normalizeBehavioralMemory(requestBody?.behavioral_memory),
  };
};

const hasExplicitUserTrigger = (req) => {
  const bodyTrigger = req.body?.trigger === "user_click";
  const headerTrigger = req.get("X-ReelBot-Trigger") === "user_click";
  return bodyTrigger && headerTrigger;
};


const isGpt5FamilyModel = /^gpt-5/i.test(OPENAI_MODEL);

const buildResponsesInput = (systemPrompt, userPrompt) => ([
  {
    role: "system",
    content: [{ type: "input_text", text: systemPrompt }],
  },
  {
    role: "user",
    content: [{ type: "input_text", text: userPrompt }],
  },
]);

const extractResponsesText = (responseData = {}) => {
  if (typeof responseData.output_text === "string" && responseData.output_text.trim()) {
    return responseData.output_text.trim();
  }

  const outputItems = Array.isArray(responseData.output) ? responseData.output : [];
  const textParts = outputItems
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text.trim())
    .filter(Boolean);

  return textParts.join("\n\n").trim();
};

const createOpenAIRequestBody = (action, systemPrompt, userPrompt) => {
  const body = {
    model: OPENAI_MODEL,
    input: buildResponsesInput(systemPrompt, userPrompt),
    max_output_tokens: REELBOT_ACTIONS[action].maxTokens,
    store: false,
  };

  if (isGpt5FamilyModel) {
    body.reasoning = { effort: OPENAI_MODEL.includes("pro") ? "high" : "minimal" };
    body.text = { verbosity: "low" };
  }

  return body;
};

const getMovieContext = async (movieId) => {
  const movie = await fetchTmdb(`/movie/${movieId}`, {
    append_to_response: "credits,reviews,similar,recommendations,videos,watch/providers",
  });

  const genres = Array.isArray(movie.genres) ? movie.genres.map((genre) => genre.name).join(", ") : "Unknown";
  const director = getDirector(movie.credits);
  const reviewHighlights = getReviewHighlights(movie.reviews?.results);
  const nearbyMovies = dedupeMoviesById([...(movie.recommendations?.results || []), ...(movie.similar?.results || [])]);
  const similarMovies = nearbyMovies.slice(0, 8).map((similarMovie) => ({
    title: similarMovie.title,
    id: similarMovie.id,
    poster_path: similarMovie.poster_path || "",
    release_date: similarMovie.release_date || "",
    overview: similarMovie.overview || "",
  }));
  const topCast = (movie.credits?.cast || []).slice(0, 5).map((castMember) => castMember.name).join(", ");

  return {
    movie,
    genres,
    director,
    topReview: reviewHighlights.positive,
    bottomReview: reviewHighlights.negative,
    similarMovies,
    topCast,
  };
};

const buildContextBlock = (context) => {
  const { movie, genres, director, topReview, bottomReview, similarMovies, topCast } = context;

  return [
    `Title: ${movie.title}`,
    `Release year: ${movie.release_date ? new Date(movie.release_date).getFullYear() : "Unknown"}`,
    `Release status: ${movie.status || "Unknown"}`,
    `Release date: ${movie.release_date || "Unknown"}`,
    `Runtime: ${movie.runtime || "Unknown"} minutes`,
    `Genres: ${genres}`,
    `Director: ${director}`,
    `Top cast: ${topCast || "Unknown"}`,
    `Tagline: ${movie.tagline || "None"}`,
    `Overview: ${truncateText(movie.overview || "No description available", 900)}`,
    `TMDB rating: ${movie.vote_average || "Unknown"}`,
    `Best review snippet: ${truncateText(topReview?.content || "No review available", 320)}`,
    `Tough review snippet: ${truncateText(bottomReview?.content || "No review available", 320)}`,
    `Similar movies: ${similarMovies.length > 0 ? similarMovies.map((similarMovie) => similarMovie.title).join(", ") : "None listed"}`,
  ].join("\n");
};

const buildPromptForAction = (action, context) => {
  const contextBlock = buildContextBlock(context);
  const previewMode = isUpcomingMovie(context.movie);

  if (previewMode) {
    switch (action) {
      case "is_this_for_me":
        return `Help a viewer decide whether this unreleased movie looks like their kind of watch using only currently known information.

${contextBlock}

Task:
- Return exactly 3 short HTML paragraphs.
- Paragraph 1 must begin with <strong>Best for:</strong> and describe the likely audience fit based on genre, premise, and talent.
- Paragraph 2 must begin with <strong>Maybe not for:</strong> and explain who may want to wait for more footage or reviews.
- Paragraph 3 must begin with <strong>What we know:</strong> and clearly signal that this is a pre-release read, not a final verdict.`;
      case "why_watch":
        return `Explain why this unreleased movie is on people's radar before it has even opened.

${contextBlock}

Task:
- Return an ordered HTML list with exactly 5 items.
- Each item should begin with a short <strong>hook</strong> followed by one concise sentence.
- Focus on cast, director, premise, scale, franchise pull, or genre promise.
- Do not write as if the movie has already been seen by a wide audience.`;
      case "similar_picks":
        return `Recommend what to watch now while someone waits for this unreleased movie.

${contextBlock}

Task:
- Return an unordered HTML list with exactly 3 movie recommendations.
- Each item must start with the movie title in <strong>Title</strong> format followed by <br />.
- Follow with exactly one concise sentence about the shared tone, themes, talent, pacing, or scale.
- Frame this as a while-you-wait recommendation set.`;
      case "scary_check":
        return `Estimate how intense this unreleased movie looks based only on the currently available synopsis, genre, and creative signals.

${contextBlock}

Task:
- Return exactly 2 short HTML paragraphs.
- Paragraph 1 must begin with <strong>Early read:</strong> and describe the likely intensity level.
- Paragraph 2 must begin with <strong>What that is based on:</strong> and explain the genre or premise signals behind that read.
- Make clear this is a preview-stage judgment, not a post-release certainty.`;
      case "pace_check":
        return `Estimate how big, sweeping, or patient this unreleased movie looks right now.

${contextBlock}

Task:
- Return exactly 2 short HTML paragraphs.
- Paragraph 1 must begin with <strong>Early read:</strong> and say whether it currently looks brisk, patient, or epic in scale.
- Paragraph 2 must begin with <strong>Why it reads that way:</strong> and explain the synopsis, runtime, genre, or director signals behind that judgment.`;
      case "best_mood":
        return `Describe the best mood or opening-week mindset for this unreleased movie.

${contextBlock}

Task:
- Return exactly 2 short HTML paragraphs.
- Paragraph 1 must begin with <strong>Best mood:</strong> and explain what kind of anticipation or viewing mood fits this title.
- Paragraph 2 must begin with <strong>Best setup:</strong> and suggest whether it feels like a solo, pair, or friends watch based on current signals.`;
      case "date_night":
        return `Judge whether this unreleased movie looks worth planning around for date night or a shared theater outing.

${contextBlock}

Task:
- Return exactly 2 short HTML paragraphs.
- Paragraph 1 must begin with <strong>Early verdict:</strong> and clearly say yes, maybe, or probably not.
- Paragraph 2 must begin with <strong>Why:</strong> and explain the likely shared-viewing appeal using only current information.`;
      case "spoiler_synopsis":
      case "ending_explained":
      case "themes_and_takeaways":
      case "debate_club":
        return `This movie has not been released yet.

${contextBlock}

Task:
- Return exactly 2 short HTML paragraphs.
- Paragraph 1 must begin with <strong>Not available yet:</strong> and explain that spoiler or post-watch analysis is not appropriate before release.
- Paragraph 2 must begin with <strong>Ask instead:</strong> and steer the viewer toward first-look, audience-fit, or while-you-wait guidance.`;
      case "quick_take":
      default:
        return `Create a spoiler-light first look for an unreleased movie using only the currently known synopsis, talent, genre, and release signals.

${contextBlock}

Task:
- Write exactly 2 short HTML paragraphs.
- Explain the likely tone, genre promise, and audience fit.
- Make clear this is a preview read rather than a final review.
- Do not imply firsthand knowledge of audience reaction or the full finished movie.`;
    }
  }

  switch (action) {
    case "is_this_for_me":
      return `Help a viewer quickly decide if this movie fits their taste, attention span, and mood.

${contextBlock}

Task:
- Return exactly 3 short HTML paragraphs.
- Paragraph 1 must begin with <strong>Best for:</strong> and explain the audience fit.
- Paragraph 2 must begin with <strong>Maybe not for:</strong> and explain who may bounce off it.
- Paragraph 3 must begin with <strong>Vibe check:</strong> and describe the energy, intensity, and ideal watch setting.
- Be specific and practical instead of generic.`;
    case "why_watch":
      return `Give a viewer-first case for watching this movie.

${contextBlock}

Task:
- Return an ordered HTML list with exactly 5 reasons someone should watch this movie.
- Each item should begin with a short <strong>hook</strong> followed by one concise sentence.
- Focus on performances, tone, direction, originality, emotional payoff, or audience fit.
- Avoid generic filler like "if you like movies".`;
    case "spoiler_synopsis":
      return `Write a full spoiler synopsis for someone who may never watch this movie but wants the full story.

${contextBlock}

Task:
- Use 4 short HTML paragraphs.
- Cover setup, escalation, major reveals, ending, and the movie's larger point.
- It is okay to spoil everything.
- Do not add a title heading because the UI already provides one.`;
    case "similar_picks":
      return `Recommend what to watch next for someone who enjoyed this movie.

${contextBlock}

Task:
- Return an unordered HTML list with exactly 3 movie recommendations.
- Each item must start with the movie title in <strong>Title</strong> format followed by <br />.
- Follow with exactly one concise sentence explaining the shared tone, themes, pacing, style, or audience experience.
- Prioritize strong fit over obvious franchise adjacency.`;
    case "scary_check":
      return `Answer whether this movie is genuinely scary or just tense for an average viewer.

${contextBlock}

Task:
- Return exactly 2 short HTML paragraphs.
- Paragraph 1 must begin with <strong>Short answer:</strong> and clearly say whether it is scary, mildly tense, or not really scary.
- Paragraph 2 must begin with <strong>Expect:</strong> and describe the kind of intensity involved without spoiling plot turns.
- Keep it practical for someone deciding what kind of night they want.`;
    case "pace_check":
      return `Answer whether this movie feels slow, steady, or brisk.

${contextBlock}

Task:
- Return exactly 2 short HTML paragraphs.
- Paragraph 1 must begin with <strong>Short answer:</strong> and describe the pace in plain language.
- Paragraph 2 must begin with <strong>Expect:</strong> and explain whether the movie is plot-driven, mood-driven, talky, or action-forward.
- Make it useful for someone deciding how attentive they need to be.`;
    case "best_mood":
      return `Describe the best mood, time, or setting for watching this movie.

${contextBlock}

Task:
- Return exactly 2 short HTML paragraphs.
- Paragraph 1 must begin with <strong>Best mood:</strong> and say when this movie is most rewarding.
- Paragraph 2 must begin with <strong>Best setting:</strong> and suggest whether it works best solo, with a partner, or with friends.
- Keep it spoiler-light and specific.`;
    case "date_night":
      return `Judge whether this movie works for date night.

${contextBlock}

Task:
- Return exactly 2 short HTML paragraphs.
- Paragraph 1 must begin with <strong>Date-night verdict:</strong> and clearly say yes, maybe, or probably not.
- Paragraph 2 must begin with <strong>Why:</strong> and explain the tone, energy, and conversation potential.
- Keep it spoiler-light and practical.`;
    case "ending_explained":
      return `Explain this movie's ending for someone who wants the spoiler version.

${contextBlock}

Task:
- Return exactly 2 short HTML paragraphs.
- Paragraph 1 must begin with <strong>What happens:</strong> and summarize the ending plainly.
- Paragraph 2 must begin with <strong>What it means:</strong> and explain the larger takeaway or emotional meaning.
- Spoilers are allowed.`;
    case "themes_and_takeaways":
      return `Pull out the clearest themes, ideas, or takeaways in this movie.

${contextBlock}

Task:
- Return an unordered HTML list with exactly 4 items.
- Each item must begin with a short <strong>theme label</strong> followed by one concise explanation.
- Focus on themes that help a viewer understand what the movie is really exploring.
- Spoilers are allowed if needed, but keep each item compact.`;
    case "debate_club":
      return `Surface the most interesting things people might debate after watching this movie.

${contextBlock}

Task:
- Return an ordered HTML list with exactly 3 items.
- Each item must begin with a short <strong>debate point</strong> followed by one sentence on why people may disagree or discuss it.
- It can include spoilers when necessary.
- Make the discussion points feel thoughtful, not clickbait-y.`;
    case "quick_take":
    default:
      return `Create a spoiler-light quick take for a viewer deciding whether this movie is a fit.

${contextBlock}

Task:
- Write 2 short HTML paragraphs.
- Explain the movie's tone, genre blend, and who it is best for.
- Keep it distinct from the studio synopsis.
- Do not reveal major plot turns or the ending.`;
  }
};

const buildFallbackContent = (action, context) => {
  const { movie, genres, director, similarMovies } = context;
  const previewMode = isUpcomingMovie(movie);
  const safeTitle = escapeHtml(movie.title);
  const safeOverview = escapeHtml(movie.overview || "No description available.");
  const safeGenres = escapeHtml(genres);
  const safeDirector = escapeHtml(director);
  const lowerGenres = safeGenres.toLowerCase();
  const releaseStatus = escapeHtml(movie.status || "Unreleased");
  const releaseDate = escapeHtml(movie.release_date || "TBA");

  if (previewMode) {
    switch (action) {
      case "is_this_for_me":
        return `
          <p><strong>Best for:</strong> Viewers already interested in ${lowerGenres} and the talent behind ${safeTitle}, especially if they like making an early call before reviews land.</p>
          <p><strong>Maybe not for:</strong> Anyone who prefers firm audience consensus, spoiler-aware guidance, or a proven word-of-mouth case may want to wait until release.</p>
          <p><strong>What we know:</strong> This is still a preview-stage read built from the current synopsis, cast, director, and release signals rather than a finished-audience reaction.</p>
        `;
      case "why_watch":
        return `
          <ol>
            <li><strong>Talent factor</strong> — The combination of ${safeDirector} and the listed cast gives ${safeTitle} real pre-release pull.</li>
            <li><strong>Genre promise</strong> — It is already signaling a clear ${lowerGenres} identity instead of feeling shapeless.</li>
            <li><strong>Conversation value</strong> — It looks like the kind of release people will want to talk about the week it opens.</li>
            <li><strong>Scope</strong> — Even before release, the setup suggests a movie with enough ambition to track early.</li>
            <li><strong>Timing</strong> — With a current release date of ${releaseDate}, this is the kind of title people may want to plan around.</li>
          </ol>
        `;
      case "similar_picks":
        return similarMovies.length > 0
          ? `<ol>${similarMovies
              .slice(0, 3)
              .map(
                (similarMovie) =>
                  `<li><strong>${escapeHtml(similarMovie.title)}</strong> — A strong while-you-wait option if you want something nearby in tone, scale, or audience appeal right now.</li>`
              )
              .join("")}</ol>`
          : `<p>ReelBot could not line up while-you-wait picks right now, but the adjacent titles below are still the best current touchstones.</p>`;
      case "scary_check":
        return `
          <p><strong>Early read:</strong> ${safeTitle} currently looks more driven by ${lowerGenres} intensity cues than by guaranteed full-on horror punishment.</p>
          <p><strong>What that is based on:</strong> This is a preview-stage read from the synopsis and genre mix, not a post-release report on exactly how hard the movie hits.</p>
        `;
      case "pace_check":
        return `
          <p><strong>Early read:</strong> ${safeTitle} looks more like a deliberate or large-scale watch than a lightweight throwaway.</p>
          <p><strong>Why it reads that way:</strong> The genre mix, current runtime listing, and direction from ${safeDirector} suggest a movie with shape and intent even before release.</p>
        `;
      case "best_mood":
        return `
          <p><strong>Best mood:</strong> This feels like a title for when you want anticipation, scale, and something to look forward to rather than pure comfort-viewing certainty.</p>
          <p><strong>Best setup:</strong> It probably works best with someone who enjoys opening-week conversation and pre-release hype, not with a crowd that only wants a sure thing.</p>
        `;
      case "date_night":
        return `
          <p><strong>Early verdict:</strong> Maybe — it depends on whether both of you enjoy planning around a promising release before the crowd consensus is in.</p>
          <p><strong>Why:</strong> ${safeTitle} looks like more of an anticipation play than a guaranteed easy date-night layup at this stage.</p>
        `;
      case "spoiler_synopsis":
      case "ending_explained":
      case "themes_and_takeaways":
      case "debate_club":
        return `
          <p><strong>Not available yet:</strong> ${safeTitle} is still marked ${releaseStatus}, so spoiler or post-watch analysis would be fake certainty.</p>
          <p><strong>Ask instead:</strong> Use First Look, Who's It For?, or While You Wait to keep the read honest until the movie is actually out.</p>
        `;
      case "quick_take":
      default:
        return `
          <p><strong>First look:</strong> ${safeOverview}</p>
          <p><strong>So far:</strong> Based on the current setup, genre promise, and talent involved, ${safeTitle} looks like a release worth tracking rather than a final verdict you can lock in today.</p>
        `;
    }
  }

  switch (action) {
    case "is_this_for_me":
      return `
        <p><strong>Best for:</strong> Viewers in the mood for ${lowerGenres} with a clearly defined creative point of view.</p>
        <p><strong>Maybe not for:</strong> Anyone looking for a purely passive, low-attention watch may want something more straightforward.</p>
        <p><strong>Vibe check:</strong> ${safeTitle} looks like the kind of movie you choose when you want a specific tone, not just background noise.</p>
      `;
    case "why_watch":
      return `
        <ol>
          <li><strong>Distinct tone</strong> — ${safeTitle} blends ${lowerGenres} into a clear viewing identity.</li>
          <li><strong>Creative point of view</strong> — The direction from ${safeDirector} gives it a more authored feel than a generic release.</li>
          <li><strong>Useful mood match</strong> — It looks best suited for viewers who want something more specific than a background watch.</li>
          <li><strong>Conversation value</strong> — Even the basic setup suggests a movie with enough personality to be worth discussing afterward.</li>
          <li><strong>Low-friction decision</strong> — The cast, genre mix, and audience signals make it easy to judge whether it fits your night.</li>
        </ol>
      `;
    case "spoiler_synopsis":
      return `
        <p><strong>Setup:</strong> ${safeOverview}</p>
        <p><strong>Note:</strong> ReelBot could not generate the full spoiler synopsis right now, so this is falling back to the official overview instead of inventing missing story beats.</p>
      `;
    case "similar_picks":
      return similarMovies.length > 0
        ? `<ul>${similarMovies
            .slice(0, 3)
            .map((similarMovie) => `<li><strong>${escapeHtml(similarMovie.title)}</strong><br />A nearby next pick with a similar pull in tone, pacing, or audience appeal.</li>`)
            .join("")}</ul>`
        : `<p>ReelBot could not line up tailored next picks right now, but the adjacent titles section below is still a solid next step.</p>`;
    case "scary_check":
      return `
        <p><strong>Short answer:</strong> Expect tension levels that come more from the movie's ${lowerGenres} identity than from extreme shock-value horror, unless the genre mix clearly signals otherwise.</p>
        <p><strong>Expect:</strong> Use the trailer, genre blend, and tone cues as your guide — this feels more like a mood-and-intensity decision than a gore-or-jump-scare guarantee.</p>
      `;
    case "pace_check":
      return `
        <p><strong>Short answer:</strong> ${safeTitle} looks more like a steady, intentional watch than a pure rush job.</p>
        <p><strong>Expect:</strong> The combination of ${lowerGenres} and direction from ${safeDirector} suggests a movie you should watch for rhythm and tone, not just plot beats.</p>
      `;
    case "best_mood":
      return `
        <p><strong>Best mood:</strong> This looks best when you want a deliberate ${lowerGenres} watch rather than something completely disposable.</p>
        <p><strong>Best setting:</strong> It probably lands best solo or with someone who wants to talk about it after, instead of a distracted group hang.</p>
      `;
    case "date_night":
      return `
        <p><strong>Date-night verdict:</strong> Maybe — it depends on whether both of you are aligned on the movie's tone and intensity.</p>
        <p><strong>Why:</strong> ${safeTitle} looks more rewarding when the mood is part of the plan, especially if you want something with conversation value after the credits.</p>
      `;
    case "ending_explained":
      return `
        <p><strong>What happens:</strong> ReelBot could not safely explain the ending right now, so the official overview is the most reliable fallback: ${safeOverview}</p>
        <p><strong>What it means:</strong> If you want a full ending breakdown, try again later — this fallback avoids inventing spoilers that are not actually supported.</p>
      `;
    case "themes_and_takeaways":
      return `
        <ul>
          <li><strong>Identity</strong> — ${safeTitle} appears interested in what defines a person once the plot pressure starts to build.</li>
          <li><strong>Control</strong> — The setup hints at characters trying to shape outcomes that may resist easy control.</li>
          <li><strong>Tone as meaning</strong> — The ${lowerGenres} framing likely matters as much as the literal plot events.</li>
          <li><strong>Aftertaste</strong> — This feels like a movie designed to leave you with an interpretation, not just a checklist of events.</li>
        </ul>
      `;
    case "debate_club":
      return `
        <ol>
          <li><strong>What it is really saying</strong> — Viewers may disagree on whether the movie is mainly about plot mechanics or a larger thematic idea.</li>
          <li><strong>Whether the tone works</strong> — The mix of ${lowerGenres} may feel bold and specific to some people, and uneven to others.</li>
          <li><strong>How much it asks from you</strong> — Some viewers will like the movie more if they want an active, interpretive watch rather than a simple ride.</li>
        </ol>
      `;
    case "quick_take":
    default:
      return `
        <p>${safeOverview}</p>
        <p><strong>Why start here:</strong> This is the fastest ReelBot read if you want the tone, the audience fit, and the best reason to press play without getting spoiled.</p>
      `;
  }
};

const buildFallbackStructuredDetailContent = (action, context, requestMeta = {}) => {
  const { movie, genres, director, similarMovies } = context;
  const genreText = String(genres || "").toLowerCase() || "movie";
  const previewMode = isUpcomingMovie(movie);
  const intent = requestMeta.intent_snapshot || null;
  const promptLabel = String(requestMeta.user_prompt || "").trim();
  const hasIntentContext = Boolean(intent && promptLabel);
  const nearbyPicks = similarMovies.slice(0, 3).map((similarMovie, index) => ({
    id: similarMovie.id,
    title: similarMovie.title,
    poster_path: similarMovie.poster_path || "",
    release_date: similarMovie.release_date || "",
    role_label: index === 0 ? "Safer next watch" : index === 1 ? "Darker next watch" : "Wildcard next watch",
    reason: index === 0
      ? "The most direct nearby option if you want a lower-risk follow-up."
      : index === 1
        ? "Pushes the same lane a little further in mood or intensity."
        : "Keeps a recognizable connection while changing the angle.",
  }));

  switch (action) {
    case "is_this_for_me":
      return previewMode
        ? {
            best_for: [
              `Viewers already interested in ${genreText}.`,
              `People tracking ${movie.title} for the cast, director, or premise.`,
            ],
            maybe_not_for: [
              "Anyone who wants firm post-release consensus first.",
              "Viewers who need a fully proven word-of-mouth case.",
            ],
            commitment: "This is an early read from the available signals rather than a final verdict.",
          }
        : {
            best_for: [
              hasIntentContext ? `Viewers whose current vibe still lines up with ${movie.title}'s ${genreText} lane.` : `People who want a ${genreText} watch with a clear point of view.`,
              "Viewers willing to meet the movie on its own tonal terms.",
            ],
            maybe_not_for: [
              hasIntentContext ? "Anyone looking for a much lighter or easier fit than this movie suggests." : "Anyone hoping for a purely passive background watch.",
              "Viewers whose mood is far lighter or broader than the movie's lane.",
            ],
            commitment: movie.runtime ? `${movie.runtime} minutes, with best results if you give it real attention.` : "Works best if you give it active attention rather than treating it as background noise.",
          };
    case "why_watch":
      return {
        reasons: [
          { label: "Tone", detail: `${movie.title} seems committed to its ${genreText} identity rather than playing generic.` },
          { label: "Craft", detail: `${director || "The direction"} gives it a stronger signature than a routine studio placeholder.` },
          { label: "Aftertaste", detail: previewMode ? "There is enough promise here to justify keeping it on the radar." : "It leaves a clearer impression than a disposable one-night watch." },
        ],
      };
    case "best_if_you_want":
      return {
        bullets: [
          `A ${genreText} watch with a specific tone rather than pure background value.`,
          movie.runtime ? `${movie.runtime} minutes is a manageable commitment if this lane sounds right.` : "A medium-commitment sit-down watch rather than pure throwaway comfort.",
          "Something with clearer identity than a generic algorithm-safe pick.",
        ],
      };
    case "similar_picks":
      return {
        intro: previewMode ? `While you wait for ${movie.title}, these are the closest nearby lanes.` : `If you want to stay near what ${movie.title} does well, start here.`,
        picks: nearbyPicks.length ? nearbyPicks : [
          { id: movie.id, title: movie.title, poster_path: movie.poster_path || "", release_date: movie.release_date || "", role_label: "Similar tone", reason: "No strong nearby titles were available, so ReelBot is holding the lane rather than guessing." },
          { id: movie.id, title: movie.title, poster_path: movie.poster_path || "", release_date: movie.release_date || "", role_label: "Safer option", reason: "No strong nearby titles were available, so ReelBot is holding the lane rather than guessing." },
          { id: movie.id, title: movie.title, poster_path: movie.poster_path || "", release_date: movie.release_date || "", role_label: "Wildcard", reason: "No strong nearby titles were available, so ReelBot is holding the lane rather than guessing." },
        ],
      };
    case "scary_check":
      return {
        verdict: previewMode ? "Early read only: this looks more tense than outright punishing." : `${movie.title} reads more as ${genreText.includes("horror") ? "genuinely intense" : "tense than all-out terrifying"}.`,
        notes: [
          "The intensity seems tied to tone and pressure, not just jump-scare volume.",
          "Use the trailer and genre lane as the best calibration if you're sensitive to intensity.",
        ],
      };
    case "pace_check":
      return {
        verdict: movie.runtime && movie.runtime >= 135 ? "More deliberate than brisk." : "Closer to steady than sluggish.",
        notes: [
          "Expect a movie you watch for rhythm and tone, not only plot beats.",
          "It is likelier to reward attention than background viewing.",
        ],
      };
    case "best_mood":
      return {
        best_when: previewMode ? "Best when you are in the mood to size up promise rather than demand certainty." : `Best when you want a ${genreText} watch with intentional tone rather than pure comfort-viewing.`,
        best_setup: "Usually better solo or with someone aligned on the tone than in a distracted group setting.",
      };
    case "date_night":
      return {
        verdict: previewMode ? "Maybe, if the appeal is part of the plan." : "Maybe — best if both people are buying into the same tone and energy.",
        why: "This works better when the mood is aligned than when one person wants something much lighter or easier.",
      };
    case "spoiler_synopsis":
      return {
        beats: [
          `Setup: ${truncateText(movie.overview || "No overview available.", 120)}`,
          "Middle: the movie builds its main conflicts and emotional pressure from there.",
          "Turn: the key reveals reframe what matters most in the story.",
          "Ending: the final stretch lands on the movie's core emotional or thematic point.",
        ],
      };
    case "ending_explained":
      return {
        what_happens: previewMode ? "Not appropriate before release." : "The ending resolves the central pressure, then leaves the viewer with the movie's intended aftertaste.",
        what_it_means: previewMode ? "Use First Look or Audience Fit instead until the movie is out." : "The last beat matters less as a plot trick than as a statement about what the movie was really exploring.",
      };
    case "themes_and_takeaways":
      return {
        themes: [
          { label: "Identity", detail: `${movie.title} appears interested in what defines a person under pressure.` },
          { label: "Control", detail: "Characters try to shape outcomes that refuse clean control." },
          { label: "Tone", detail: `The ${genreText} framing carries meaning, not just surface style.` },
          { label: "Aftertaste", detail: "The movie seems built to leave an interpretation behind, not just plot resolution." },
        ],
      };
    case "debate_club":
      return {
        points: [
          { label: "What it is really about", detail: "People may disagree on whether the movie is mainly a plot machine or a thematic one." },
          { label: "Whether the tone pays off", detail: `The ${genreText} approach will feel precise to some viewers and overly controlled to others.` },
          { label: "How much it asks from you", detail: "Its value depends partly on whether you wanted an active watch or a simpler ride." },
        ],
      };
    case "quick_take":
    default:
      return previewMode
        ? {
            summary: `${movie.title} looks like a ${genreText} release with enough identity to track before reviews arrive.`,
            fit: "Best for viewers already interested in the lane, talent, or scale.",
            caution: "Treat this as a preview read, not a finished-audience verdict.",
          }
        : {
            summary: hasIntentContext
              ? `${movie.title} is ${intent?.emotional_weight === "light" ? "more selective than pure comfort viewing" : `a deliberate ${genreText} choice`} against the vibe you gave ReelBot.`
              : `${movie.title} plays more like a deliberate ${genreText} choice than a generic fallback.`,
            fit: hasIntentContext
              ? `Best if your current mood still matches ${promptLabel}.`
              : "Best for viewers who want a clear tonal lane and can meet the movie on its own terms.",
            caution: hasIntentContext
              ? "If you wanted something easier, lighter, or lower-friction, this may feel like more of a commitment."
              : "Less ideal if you want pure background ease or a broader crowd-pleaser.",
          };
  }
};

const normalizeTitleKey = (value = "") => String(value || "").trim().toLowerCase();

const enrichSimilarPickEntries = (entries = [], context = {}) => {
  const similarMovies = Array.isArray(context.similarMovies) ? context.similarMovies : [];
  const movie = context.movie || {};
  const similarMovieLookup = new Map(similarMovies.map((similarMovie) => [normalizeTitleKey(similarMovie.title), similarMovie]));

  return (Array.isArray(entries) ? entries : []).map((entry, index) => {
    const matchedMovie =
      (entry?.id && similarMovies.find((similarMovie) => similarMovie.id === entry.id)) ||
      similarMovieLookup.get(normalizeTitleKey(entry?.title)) ||
      similarMovies[index] ||
      null;

    return {
      id: matchedMovie?.id || entry?.id || movie.id,
      title: normalizeAiCopy(entry?.title) || matchedMovie?.title || movie.title,
      poster_path: matchedMovie?.poster_path || entry?.poster_path || movie.poster_path || "",
      release_date: matchedMovie?.release_date || entry?.release_date || movie.release_date || "",
      role_label: normalizeAiCopy(entry?.role_label) || "Nearby pick",
      reason: normalizeAiCopy(entry?.reason) || "Keeps a recognizable connection without repeating the exact same lane.",
    };
  }).slice(0, 3);
};

const renderStructuredReelbotContent = (action, content = {}) => {
  switch (action) {
    case "quick_take":
      return `<p>${escapeHtml(content.summary || "")}</p><p><strong>Who it's for:</strong> ${escapeHtml(content.fit || "")}</p><p><strong>Watch note:</strong> ${escapeHtml(content.caution || "")}</p>`;
    case "is_this_for_me":
      return `<p><strong>Best for:</strong> ${escapeHtml((content.best_for || []).join(" "))}</p><p><strong>Maybe not for:</strong> ${escapeHtml((content.maybe_not_for || []).join(" "))}</p><p><strong>Commitment:</strong> ${escapeHtml(content.commitment || "")}</p>`;
    case "why_watch":
      return `<ol>${(content.reasons || []).map((entry) => `<li><strong>${escapeHtml(entry.label || "")}</strong> — ${escapeHtml(entry.detail || "")}</li>`).join("")}</ol>`;
    case "best_if_you_want":
      return `<ul>${(content.bullets || []).map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>`;
    case "similar_picks":
      return `<p>${escapeHtml(content.intro || "")}</p><ul>${(content.picks || []).map((entry) => `<li><strong>${escapeHtml(entry.title || "")}</strong><br /><em>${escapeHtml(entry.role_label || "")}</em> — ${escapeHtml(entry.reason || "")}</li>`).join("")}</ul>`;
    case "scary_check":
    case "pace_check":
      return `<p><strong>Verdict:</strong> ${escapeHtml(content.verdict || "")}</p><ul>${(content.notes || []).map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>`;
    case "best_mood":
      return `<p><strong>Best when:</strong> ${escapeHtml(content.best_when || "")}</p><p><strong>Best setup:</strong> ${escapeHtml(content.best_setup || "")}</p>`;
    case "date_night":
      return `<p><strong>Verdict:</strong> ${escapeHtml(content.verdict || "")}</p><p><strong>Why:</strong> ${escapeHtml(content.why || "")}</p>`;
    case "spoiler_synopsis":
      return `<ol>${(content.beats || []).map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>`;
    case "ending_explained":
      return `<p><strong>What happens:</strong> ${escapeHtml(content.what_happens || "")}</p><p><strong>What it means:</strong> ${escapeHtml(content.what_it_means || "")}</p>`;
    case "themes_and_takeaways":
      return `<ul>${(content.themes || []).map((entry) => `<li><strong>${escapeHtml(entry.label || "")}</strong> — ${escapeHtml(entry.detail || "")}</li>`).join("")}</ul>`;
    case "debate_club":
      return `<ol>${(content.points || []).map((entry) => `<li><strong>${escapeHtml(entry.label || "")}</strong> — ${escapeHtml(entry.detail || "")}</li>`).join("")}</ol>`;
    default:
      return normalizeRichText(JSON.stringify(content));
  }
};

const generateStructuredDetailContent = async (action, context, requestMeta = {}) => {
  const previewMode = isUpcomingMovie(context.movie);
  const fallbackStructuredContent = buildFallbackStructuredDetailContent(action, context, requestMeta);

  if (!OPENAI_API_KEY) {
    return fallbackStructuredContent;
  }

  try {
    const prompts = buildDetailPrompts({ action, context, previewMode, requestMeta });
    const aiPayload = await callStructuredOpenAI({
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      schema: getDetailSchema(action),
      schemaName: `reelbot_detail_${action}`,
      maxTokens: REELBOT_ACTIONS[action]?.maxTokens || 320,
      temperature: 0.35,
    });
    const structuredPayload = aiPayload || fallbackStructuredContent;

    if (action === "similar_picks") {
      return {
        ...structuredPayload,
        picks: enrichSimilarPickEntries(structuredPayload?.picks, context),
      };
    }

    return structuredPayload;
  } catch (error) {
    console.error("OpenAI detail assistant failed:", error.response?.data || error.message);
    return fallbackStructuredContent;
  }
};

const generateReelbotPayload = async (movieId, requestedAction = "quick_take", requestMeta = {}) => {
  const action = normalizeAction(requestedAction);
  const context = await getMovieContext(movieId);
  const previewMode = isUpcomingMovie(context.movie);
  const normalizedRequestMeta = {
    ...requestMeta,
    prompt_template: requestMeta.prompt_template || (previewMode ? "detail_preview" : SPOILER_ACTION_IDS.has(action) ? "detail_spoiler" : "detail_standard"),
    use_case: requestMeta.use_case || action,
  };
  const intentCacheKey = normalizedRequestMeta.intent_snapshot?.lane_key || normalizedRequestMeta.user_prompt?.toLowerCase() || "generic";
  const behaviorCacheKey = normalizedRequestMeta.behavioral_memory?.updatedAt || "no-memory";
  const cacheKey = `${movieId}:${action}:${normalizedRequestMeta.prompt_template}:${normalizedRequestMeta.use_case}:${normalizedRequestMeta.spoiler_mode ? "spoilers-on" : "spoilers-off"}:${intentCacheKey}:${behaviorCacheKey}`;

  if (reelbotCache.has(cacheKey)) {
    return { ...reelbotCache.get(cacheKey), cached: true };
  }

  console.log(`Received ReelBot request for movie ID: ${movieId}, action: ${action}`);

  const structuredContent = await generateStructuredDetailContent(action, context, normalizedRequestMeta);
  const content = renderStructuredReelbotContent(action, structuredContent);

  const payload = {
    movie_id: context.movie.id,
    title: context.movie.title,
    action,
    label: REELBOT_ACTIONS[action].label,
    spoiler_mode: normalizedRequestMeta.spoiler_mode,
    prompt_template: normalizedRequestMeta.prompt_template,
    use_case: normalizedRequestMeta.use_case,
    request_context: {
      user_prompt: normalizedRequestMeta.user_prompt || "",
      intent_snapshot: normalizedRequestMeta.intent_snapshot || null,
    },
    structured_content: structuredContent,
    content,
    ai_name: AI_NAME,
    generated_at: new Date().toISOString(),
  };

  reelbotCache.set(cacheKey, payload);
  return { ...payload, cached: false };
};

app.get("/", (req, res) => {
  res.send("Movie Review Backend is Running!");
});

app.get("/movies/watch-providers", async (req, res) => {
  const ids = String(req.query.ids || "")
    .split(",")
    .map((value) => Number.parseInt(value, 10))
    .filter(Boolean)
    .slice(0, 24);

  if (!ids.length) {
    return res.json({ results: [] });
  }

  try {
    const responses = await Promise.allSettled(
      ids.map(async (movieId) => {
        const payload = await fetchTmdbCached(`/movie/${movieId}/watch/providers`, {}, CACHE_TTLS.movie_details);
        const availability = normalizeWatchProviders(payload);
        return {
          id: movieId,
          watch_providers: availability,
          provider_badges: buildProviderBadges(availability),
        };
      })
    );

    res.set("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=3600");
    res.json({
      results: responses
        .filter((response) => response.status === "fulfilled")
        .map((response) => response.value),
    });
  } catch (error) {
    console.error("❌ Error fetching movie watch providers:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch watch providers" });
  }
});

app.get("/movies/:id", async (req, res) => {
  const movieId = req.params.id;

  try {
    console.log(`Fetching details for movie ID: ${movieId}`);
    const movie = await fetchTmdb(`/movie/${movieId}`, {
      append_to_response: "credits,reviews,similar,recommendations,videos,watch/providers",
    });

    rememberMovieForSitemap(movie);
    (movie.similar?.results || []).slice(0, 6).forEach((item) => rememberMovieForSitemap(item));
    (movie.recommendations?.results || []).slice(0, 6).forEach((item) => rememberMovieForSitemap(item));

    res.json(normalizeMovieDetails(movie));
  } catch (error) {
    console.error("❌ Error fetching movie details:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch movie details" });
  }
});

const formatDate = (value) => value.toISOString().split("T")[0];

const isFutureRelease = (movie, monthsOut = 12) => {
  const releaseDate = movie?.release_date ? new Date(movie.release_date) : null;
  if (!(releaseDate instanceof Date) || Number.isNaN(releaseDate.getTime())) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const latestAllowedDate = new Date(today);
  latestAllowedDate.setMonth(latestAllowedDate.getMonth() + monthsOut);

  return releaseDate >= today && releaseDate <= latestAllowedDate;
};

const isCurrentTheatricalRelease = (movie, pastDays = 120, futureDays = 21) => {
  const releaseDate = movie?.release_date ? new Date(movie.release_date) : null;
  if (!(releaseDate instanceof Date) || Number.isNaN(releaseDate.getTime())) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const earliestAllowedDate = new Date(today);
  earliestAllowedDate.setDate(earliestAllowedDate.getDate() - pastDays);

  const latestAllowedDate = new Date(today);
  latestAllowedDate.setDate(latestAllowedDate.getDate() + futureDays);

  return releaseDate >= earliestAllowedDate && releaseDate <= latestAllowedDate;
};

const sortLatestMovies = (left, right) => {
  const releaseDateDiff = new Date(right.release_date || 0) - new Date(left.release_date || 0);

  if (releaseDateDiff !== 0) {
    return releaseDateDiff;
  }

  const voteCountDiff = (right.vote_count || 0) - (left.vote_count || 0);
  if (voteCountDiff !== 0) {
    return voteCountDiff;
  }

  return (right.popularity || 0) - (left.popularity || 0);
};

const sortPopularMovies = (left, right) => {
  const popularityDiff = (right.popularity || 0) - (left.popularity || 0);
  if (popularityDiff !== 0) {
    return popularityDiff;
  }

  const voteCountDiff = (right.vote_count || 0) - (left.vote_count || 0);
  if (voteCountDiff !== 0) {
    return voteCountDiff;
  }

  return new Date(right.release_date || 0) - new Date(left.release_date || 0);
};

const sortUpcomingMovies = (left, right) => {
  const releaseDateDiff = new Date(left.release_date || 0) - new Date(right.release_date || 0);
  if (releaseDateDiff !== 0) {
    return releaseDateDiff;
  }

  const popularityDiff = (right.popularity || 0) - (left.popularity || 0);
  if (popularityDiff !== 0) {
    return popularityDiff;
  }

  return (right.vote_count || 0) - (left.vote_count || 0);
};

const filterLatestResults = (results = []) =>
  results
    .filter((movie) => movie.poster_path)
    .filter((movie) => !movie.adult)
    .filter((movie) => isCurrentTheatricalRelease(movie))
    .filter((movie) => hasEnoughMovieSignal(movie))
    .sort(sortLatestMovies);

const filterPopularResults = (results = []) =>
  results
    .filter((movie) => movie.poster_path)
    .filter((movie) => !movie.adult)
    .filter((movie) => hasEnoughMovieSignal(movie))
    .sort(sortPopularMovies);

const filterUpcomingResults = (results = []) =>
  results
    .filter((movie) => movie.poster_path)
    .filter((movie) => !movie.adult)
    .filter((movie) => isFutureRelease(movie, 12))
    .sort(sortUpcomingMovies);

const sortDiscoveryResults = (type, results = []) => {
  if (normalizeDiscoveryView(type) === "popular") {
    return filterPopularResults(results);
  }

  if (normalizeDiscoveryView(type) === "upcoming") {
    return filterUpcomingResults(results);
  }

  return filterLatestResults(results);
};

const fetchHomepageFeed = async (type, pageNumber) => {
  const normalizedType = normalizeDiscoveryView(type);
  const shouldRotateFirstPage = normalizedType !== "upcoming";
  const requestedPage = Math.max(1, Number.parseInt(pageNumber, 10) || 1);
  const sourcePage = requestedPage > 1 || !shouldRotateFirstPage ? requestedPage : getRotatedPage(normalizedType, 0);
  let payload = await fetchFeedBatch(normalizedType, sourcePage);
  let results = Array.isArray(payload.results) ? payload.results : [];

  if (!results.length && sourcePage !== 1) {
    payload = await fetchFeedBatch(normalizedType, 1);
    results = Array.isArray(payload.results) ? payload.results : [];
  }

  const minimumCount = HOMEPAGE_MIN_FEED_RESULTS[normalizedType] || 0;
  const lookaheadLimit = HOMEPAGE_FILL_LOOKAHEAD[normalizedType] || 0;
  const totalPages = payload.total_pages || 1;

  if (minimumCount > 0 && results.length < minimumCount) {
    const collected = [...results];
    const seenIds = new Set(collected.map((movie) => movie.id));

    for (let offset = 1; offset <= lookaheadLimit && collected.length < minimumCount; offset += 1) {
      const nextPage = sourcePage + offset;
      if (nextPage > totalPages) {
        break;
      }

      const nextPayload = await fetchFeedBatch(normalizedType, nextPage);
      (nextPayload.results || []).forEach((movie) => {
        if (!movie?.id || seenIds.has(movie.id)) {
          return;
        }

        seenIds.add(movie.id);
        collected.push(movie);
      });
    }

    results = collected;
  }

  return {
    page: requestedPage,
    total_pages: totalPages,
    total_results: payload.total_results || results.length,
    results,
    source_page: sourcePage,
  };
};

const fetchFilledDiscoverResults = async (type, pageNumber, options = {}, fillCount = 0) => {
  const normalizedType = normalizeDiscoveryView(type);
  const minimumCount = Math.max(0, Number.parseInt(fillCount, 10) || 0);
  const hasFilters = Boolean(options.genre) || options.runtime !== "any";

  if (!hasFilters) {
    return fetchHomepageFeed(normalizedType, pageNumber);
  }

  if (minimumCount <= 0 || pageNumber !== 1) {
    const discoverPage = pageNumber > 1 ? pageNumber : getRotatedPage("discover", 0);
    const payload = await fetchTmdbCached("/discover/movie", buildDiscoverParams(normalizedType, discoverPage, options), CACHE_TTLS.discover);
    const sourcedResults = withMovieSource(payload.results, "discover", "/discover/movie");
    return {
      ...payload,
      page: pageNumber,
      results: sortDiscoveryResults(normalizedType, sourcedResults),
    };
  }

  const discoverPages = [getRotatedPage("discover", 0), getRotatedPage("discover", 1)];
  const responses = await Promise.allSettled(
    discoverPages.map((discoverPage) =>
      fetchTmdbCached("/discover/movie", buildDiscoverParams(normalizedType, discoverPage, options), CACHE_TTLS.discover)
    )
  );

  const collected = dedupeMoviesById(
    responses
      .filter((response) => response.status === "fulfilled")
      .flatMap((response) => sortDiscoveryResults(normalizedType, withMovieSource(response.value.results, "discover", "/discover/movie")))
  );
  const totalPages = responses.find((response) => response.status === "fulfilled")?.value?.total_pages || 1;

  return {
    page: 1,
    total_pages: totalPages,
    total_results: collected.length,
    results: collected.slice(0, minimumCount),
  };
};

const buildPickFallbackPayload = async (rawPreferences = {}, message) => {
  const preferences = resolvePickPreferences(rawPreferences);
  const resolvedIntent = await hydrateResolvedIntent(preferences, rawPreferences);
  const queryType = resolvedIntent.query_type || getIntentQueryType(resolvedIntent);
  const summary = message || buildPickErrorSummary(preferences);

  return {
    label: "Pick for Me",
    summary,
    resolved_preferences: preferences,
    resolved_intent: resolvedIntent,
    validation: {
      query_type: queryType,
      hard_lock_applied: ["PERSON", "DIRECTOR", "FRANCHISE", "TITLE_SIMILARITY"].includes(queryType),
      primary_valid: false,
      alternates_valid: true,
    },
    candidate_pool_ids: Array.isArray(rawPreferences.candidate_pool_ids)
      ? rawPreferences.candidate_pool_ids.map((value) => Number.parseInt(value, 10)).filter(Boolean)
      : [],
    primary: null,
    alternates: [],
    cached: false,
    degraded: true,
  };
};

app.get("/sitemap.xml", async (req, res) => {
  try {
    const feedPayloads = await Promise.allSettled([
      fetchHomepageFeed("latest", 1),
      fetchHomepageFeed("popular", 1),
      fetchHomepageFeed("upcoming", 1),
    ]);

    feedPayloads
      .filter((response) => response.status === "fulfilled")
      .flatMap((response) => response.value?.results || [])
      .slice(0, 120)
      .forEach((movie) => rememberMovieForSitemap(movie));

    const staticEntries = [
      { path: "/", priority: "1.0", changefreq: "daily" },
      { path: "/browse", priority: "0.9", changefreq: "daily" },
      { path: "/now-playing", priority: "0.9", changefreq: "daily" },
      { path: "/trending", priority: "0.8", changefreq: "daily" },
      { path: "/coming-soon", priority: "0.8", changefreq: "daily" },
      { path: "/how-reelbot-works", priority: "0.6", changefreq: "weekly" },
    ];

    const movieEntries = Array.from(sitemapMovieIndex.values())
      .sort((left, right) => new Date(right.updated_at || 0) - new Date(left.updated_at || 0))
      .slice(0, 500)
      .map((movie) => ({
        loc: `${SITE_ORIGIN}${buildMovieCanonicalPath(movie)}`,
        lastmod: movie.updated_at || undefined,
        changefreq: "weekly",
        priority: "0.7",
      }));

    const xmlEntries = [
      ...staticEntries.map((entry) => [
        "  <url>",
        `    <loc>${escapeXml(`${SITE_ORIGIN}${entry.path}`)}</loc>`,
        `    <changefreq>${entry.changefreq}</changefreq>`,
        `    <priority>${entry.priority}</priority>`,
        "  </url>",
      ].join("\n")),
      ...movieEntries.map((entry) => [
        "  <url>",
        `    <loc>${escapeXml(entry.loc)}</loc>`,
        entry.lastmod ? `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : null,
        `    <changefreq>${entry.changefreq}</changefreq>`,
        `    <priority>${entry.priority}</priority>`,
        "  </url>",
      ].filter(Boolean).join("\n")),
    ].join("\n");

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      xmlEntries,
      '</urlset>',
    ].join("\n");

    res.set("Content-Type", "application/xml; charset=utf-8");
    res.set("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=300");
    res.send(xml);
  } catch (error) {
    console.error("❌ Error generating sitemap:", error.response?.data || error.message);
    res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><error>Failed to generate sitemap</error>');
  }
});

app.get("/movies", async (req, res) => {
  const { type = "latest", page = 1, genre = "", runtime = "any", fill = 0 } = req.query;
  const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
  const normalizedType = normalizeDiscoveryView(type);

  try {
    const payload = await fetchFilledDiscoverResults(normalizedType, pageNumber, {
      genre: genre || undefined,
      runtime,
    }, fill);

    (payload.results || []).slice(0, 48).forEach((movie) => rememberMovieForSitemap(movie));
    res.set("Cache-Control", buildFeedCacheControlHeader(normalizedType));
    res.json(payload);
  } catch (error) {
    console.error(`❌ Error fetching ${normalizedType} movies:`, error.response?.data || error.message);
    res.status(500).json({ error: `Failed to fetch ${normalizedType} movies` });
  }
});

app.get("/genres", async (req, res) => {
  try {
    const payload = await fetchTmdb("/genre/movie/list");
    const genres = Array.isArray(payload.genres)
      ? payload.genres
          .filter((genre) => ![99, 10770].includes(genre.id))
          .sort((left, right) => left.name.localeCompare(right.name))
      : [];

    res.json({ genres });
  } catch (error) {
    console.error("❌ Error fetching genres:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch genres" });
  }
});

app.post("/auth/delete-account", async (req, res) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({ error: "Account deletion is not configured yet." });
    }

    const authorizationHeader = String(req.headers.authorization || "");
    const accessToken = authorizationHeader.startsWith("Bearer ") ? authorizationHeader.slice(7).trim() : "";

    if (!accessToken) {
      return res.status(401).json({ error: "Missing account session." });
    }

    const user = await fetchSupabaseUser(accessToken);
    if (!user?.id) {
      return res.status(401).json({ error: "Could not verify this account session." });
    }

    await deleteSupabaseUser(user.id);
    return res.json({ ok: true });
  } catch (error) {
    console.error("Error deleting ReelBot account:", error?.response?.data || error.message || error);
    return res.status(500).json({ error: "We couldn't delete this account right now." });
  }
});

app.get("/search", async (req, res) => {
  const { query, page = 1 } = req.query;

  if (!query) {
    return res.status(400).json({ error: "Search query is required" });
  }

  try {
    const payload = await fetchTmdbCached(
      "/search/movie",
      { query, page, include_adult: "false", region: "US" },
      5 * 60 * 1000
    );
    const rankedResults = rankSearchResults(payload.results || [], query);
    const topMatch = rankedResults[0] || null;
    const relatedResults = topMatch ? rankedResults.slice(1) : rankedResults;
    rankedResults.slice(0, 24).forEach((movie) => rememberMovieForSitemap(movie));
    res.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=60");
    res.json({
      ...payload,
      results: rankedResults,
      top_match: topMatch,
      related_results: relatedResults,
      total_results: rankedResults.length,
    });
  } catch (error) {
    console.error("❌ Error fetching search results:", error);
    res.status(500).json({ error: "Failed to fetch search results" });
  }
});

app.post("/reelbot/pick", async (req, res) => {
  if (!hasExplicitUserTrigger(req)) {
    return res.status(400).json({
      error: "ReelBot pick requests must come from an explicit user click.",
    });
  }

  try {
    const payload = await generatePickPayload(req.body || {});
    res.json(payload);
  } catch (error) {
    console.error("Error generating ReelBot pick:", error.response?.data || error.message);
    res.json(await buildPickFallbackPayload(req.body || {}));
  }
});

app.get("/movies/:id/reelbot", (req, res) => {
  res.status(405).json({
    error: "ReelBot requires an explicit POST user action.",
  });
});

app.post("/movies/:id/reelbot", async (req, res) => {
  const movieId = req.params.id;
  const action = req.body?.action || "quick_take";
  const requestMovieId = String(req.body?.movie_id || "").trim();
  const normalizedAction = normalizeAction(action);
  const requestMeta = normalizeReelbotRequestMeta(normalizedAction, req.body || {});

  if (!hasExplicitUserTrigger(req)) {
    return res.status(400).json({
      error: "ReelBot requests must come from an explicit user click.",
    });
  }

  if (requestMovieId && requestMovieId !== String(movieId)) {
    return res.status(400).json({
      error: "ReelBot request movie id did not match the detail page movie.",
    });
  }

  if (SPOILER_ACTION_IDS.has(normalizedAction) && !requestMeta.spoiler_mode) {
    return res.status(400).json({
      error: "Spoiler Mode must be on for spoiler ReelBot answers.",
    });
  }

  try {
    const payload = await generateReelbotPayload(movieId, normalizedAction, requestMeta);
    res.json(payload);
  } catch (error) {
    console.error("Error generating ReelBot response:", error.response?.data || error.message);
    const status = error.response?.status || 500;
    const errBody = error.response?.data || { message: error.message };
    res.status(status).json({ error: errBody });
  }
});

app.get("/movies/:id/ai-summary", async (req, res) => {
  const movieId = req.params.id;

  try {
    console.warn(`Legacy ai-summary route hit for movie ID: ${movieId}. Returning non-AI fallback.`);
    const context = await getMovieContext(movieId);
    const fallbackSummary = normalizeRichText(buildFallbackContent("quick_take", context));

    res.json({
      movie_id: context.movie.id,
      title: context.movie.title,
      action: "quick_take",
      label: REELBOT_ACTIONS.quick_take.label,
      summary: fallbackSummary,
      ai_name: AI_NAME,
      generated_at: new Date().toISOString(),
      cached: false,
      legacy_fallback: true,
    });
  } catch (error) {
    console.error("Error serving legacy AI summary fallback:", error.response?.data || error.message);
    const status = error.response?.status || 500;
    const errBody = error.response?.data || { message: error.message };
    res.status(status).json({ error: errBody });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
