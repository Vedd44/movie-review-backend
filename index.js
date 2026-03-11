require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5001;
const AI_NAME = "ReelBot";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const TMDB_API_KEY = process.env.TMDB_API_KEY?.trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || "gpt-5-mini").trim();
const reelbotCache = new Map();
const pickCache = new Map();
const tmdbCache = new Map();
const pickSurfaceTally = new Map();
const promptLookupCache = new Map();

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

console.log(`OpenAI model configured: ${OPENAI_MODEL}`);
console.log(`OpenAI API key present: ${OPENAI_API_KEY ? "yes" : "no"}`);
console.log(`TMDB API key present: ${TMDB_API_KEY ? "yes" : "no"}`);

app.use(cors());
app.use(express.json());

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

const getPromptMovieBoosts = async (prompt = "") => {
  const normalizedPrompt = String(prompt || "").trim().toLowerCase();

  if (!normalizedPrompt) {
    return { personMovieIds: new Set(), promptTokens: [] };
  }

  if (promptLookupCache.has(normalizedPrompt)) {
    return promptLookupCache.get(normalizedPrompt);
  }

  const promptTokens = tokenizePrompt(prompt).filter((token) => !PROMPT_STOPWORDS.has(token));
  const result = { personMovieIds: new Set(), promptTokens };
  const queries = getPromptSearchQueries(prompt);

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

      const credits = await fetchTmdb(`/person/${person.id}/movie_credits`);
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

  promptLookupCache.set(normalizedPrompt, result);
  return result;
};

const getPromptSignals = (prompt = "") => {
  const normalizedPrompt = String(prompt || "").toLowerCase();

  const mood = normalizedPrompt.match(/mind|twist|weird|sci-?fi|smart/)
    ? "mind_bending"
    : normalizedPrompt.match(/dark|intense|grim|creepy|thriller|horror/)
      ? "dark"
      : normalizedPrompt.match(/funny|comedy|laugh|light|comfort|easy/)
        ? "funny"
        : normalizedPrompt.match(/emotional|romance|feel|moving|heart/)
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

const buildPickSuccessSummary = (preferences) => {
  const promptLabel = formatPickPromptForSummary(preferences.prompt);

  if (promptLabel) {
    return preferences.source === "library"
      ? `You asked for ${promptLabel}, and this feels like the best place to start from the full library.`
      : `You asked for ${promptLabel}, and this feels like the best fit on this page tonight.`;
  }

  const setupPhrase = buildPickSetupPhrase(preferences);

  if (setupPhrase) {
    return preferences.source === "library"
      ? `If you're after something ${setupPhrase}, this feels like the best place to start from the full library.`
      : `If you're after something ${setupPhrase}, this feels like the best fit on this page tonight.`;
  }

  return preferences.source === "library"
    ? "If you want one strong place to start, this feels like a good first pick from the full library."
    : "If you want one confident place to start, this feels like the best pick on this page tonight.";
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

  if (movie.original_language && movie.original_language !== "en") {
    return true;
  }

  const voteCount = movie.vote_count || 0;
  const popularity = movie.popularity || 0;
  return voteCount < 8 && popularity < 15;
};

const fetchFeedBatch = async (type, pageNumber) => {
  const normalizedType = normalizeDiscoveryView(type);
  const ttlMs = getFeedCacheTtl(normalizedType);

  if (normalizedType === "popular") {
    const payload = await fetchTmdbCached("/movie/popular", { page: pageNumber, region: "US" }, ttlMs);
    return filterPopularResults(payload.results);
  }

  if (normalizedType === "upcoming") {
    const payload = await fetchTmdbCached("/movie/upcoming", { page: pageNumber, region: "US" }, ttlMs);
    return filterUpcomingResults(payload.results);
  }

  const payload = await fetchTmdbCached("/movie/now_playing", { page: pageNumber, region: "US" }, ttlMs);
  return filterLatestResults(payload.results);
};

const fetchDiscoverBatch = async (type, pageNumber, options = {}) => {
  const payload = await fetchTmdbCached(
    "/discover/movie",
    buildDiscoverParams(type, pageNumber, options),
    CACHE_TTLS.discover
  );

  return sortDiscoveryResults(type, payload.results);
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

const scorePickCandidate = (movie, preferences, promptBoosts = { personMovieIds: new Set(), promptTokens: [] }) => {
  let score = (movie.vote_average || 0) * 10;
  score += Math.min(movie.vote_count || 0, 1800) / 38;
  score += Math.min(movie.popularity || 0, 800) / 48;
  score += getQualityFitBoost(movie);
  score -= getExposurePenalty(movie);

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

    if (promptSignals.mood && matchesAnyGenre(movie.genre_ids || [], PICK_MOOD_CONFIG[promptSignals.mood].genreIds)) {
      score += 8;
    }

    if (promptSignals.company && matchesAnyGenre(movie.genre_ids || [], PICK_COMPANY_CONFIG[promptSignals.company].genreIds)) {
      score += 6;
    }

    if (promptBoosts.personMovieIds?.has(movie.id)) {
      score += 46;
    }

    const titleMatches = countPromptMatches(movie.title, promptBoosts.promptTokens || []);
    const overviewMatches = countPromptMatches(movie.overview, promptBoosts.promptTokens || []);
    score += titleMatches * 9;
    score += overviewMatches * 3;
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

  return score;
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

  if (preferences.runtime !== "any") {
    return getPickRuntimeReason(preferences.runtime);
  }

  if (preferences.company !== "any") {
    return getPickCompanyReason(preferences.company);
  }

  if (preferences.mood !== "all") {
    return getPickMoodReason(preferences.mood);
  }

  if (leadingGenres) {
    return `Leans into a ${leadingGenres.toLowerCase()} mix without feeling like an obvious default pick`;
  }

  return "Strong enough to feel like a deliberate pick instead of the usual default";
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
  match_score: overrides.match_score || null,
  reason: overrides.reason || buildPickReason(movie, preferences),
});

const getPickCandidatePool = async (preferences) => {
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
    .flatMap((response) => response.value || []);

  return dedupeMoviesById(merged).filter((movie) => !isLowSignalMovie(movie)).slice(0, 100);
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
    vote_average: payload.vote_average || 0,
    vote_count: payload.vote_count || 0,
    popularity: payload.popularity || 0,
    overview: payload.overview || "",
  };
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
  overview: truncateText(movie.overview || "", 180),
});

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

const buildPickRankingPrompt = (preferences, candidates) => {
  const candidateBlock = candidates.map((movie) => stableStringify(buildCompactCandidate(movie))).join("\n");

  return `User preferences:\n${stableStringify({
    source: preferences.source,
    view: preferences.view,
    mood: preferences.mood,
    runtime: preferences.runtime,
    company: preferences.company,
    prompt: preferences.prompt,
  })}\n\nCandidate pool:\n${candidateBlock}\n\nChoose exactly 1 best pick and 3 backup picks from the provided candidate ids only. Prefer high-fit recommendations that match the requested mood, runtime, and setup, but avoid overexposed or extremely famous default classics unless they are an exceptional fit. Do not simply pick the most universally famous title. Keep backups meaningfully different in tone, era, or intensity while staying in the same overall lane.`;
};

const rankCandidatesWithOpenAI = async (preferences, candidates) => {
  if (!OPENAI_API_KEY || !candidates.length) {
    return null;
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      assistant_note: { type: "string" },
      primary: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "integer" },
          reason: { type: "string" },
          match_score: { type: "integer" },
        },
        required: ["id", "reason", "match_score"],
      },
      backups: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "integer" },
            reason: { type: "string" },
          },
          required: ["id", "reason"],
        },
      },
    },
    required: ["summary", "assistant_note", "primary", "backups"],
  };

  const response = await axios.post(
    "https://api.openai.com/v1/responses",
    {
      model: "gpt-5-mini",
      input: buildResponsesInput(
        `You are ${AI_NAME}, a grounded movie-night assistant. Rank only from the supplied candidates. Never invent titles. Favor strong tonight-fit over all-time-famous defaults. Keep reasoning concise, practical, and non-redundant. Return valid JSON that matches the schema.`,
        buildPickRankingPrompt(preferences, candidates)
      ),
      temperature: 0.4,
      max_output_tokens: 450,
      store: false,
      reasoning: { effort: "minimal" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "reelbot_pick_ranking",
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

const buildMatchScore = (score, topScore) => {
  if (!topScore) {
    return 78;
  }

  const relativeGap = Math.max(0, topScore - score);
  return Math.max(68, Math.min(96, Math.round(94 - (relativeGap / Math.max(topScore, 1)) * 28)));
};

const generatePickPayload = async (rawPreferences = {}) => {
  const preferences = resolvePickPreferences(rawPreferences);
  const excludedIds = normalizeExcludedIds(rawPreferences.excluded_ids);
  const refreshKey = rawPreferences.refresh_key ? String(rawPreferences.refresh_key) : "";
  const cacheKey = `pick:${preferences.source}:${preferences.view}:${preferences.genre}:${preferences.mood}:${preferences.runtime}:${preferences.company}:${preferences.prompt.toLowerCase()}:excluded:${Array.from(excludedIds).sort((left, right) => left - right).join(",")}`;

  if (!refreshKey) {
    const cachedPayload = readCache(pickCache, cacheKey);
    if (cachedPayload) {
      return { ...cachedPayload, cached: true };
    }
  }

  const promptBoosts = await getPromptMovieBoosts(preferences.prompt);
  const candidatePool = await getPickCandidatePool(preferences);
  const fallbackPool = !candidatePool.length && (preferences.mood !== "all" || preferences.runtime !== "any")
    ? await getPickCandidatePool({ ...preferences, mood: "all", runtime: "any" })
    : candidatePool;

  const locallyFilteredPool = fallbackPool.filter((movie) => !excludedIds.has(movie.id) && !isLowSignalMovie(movie));
  const preliminaryRanked = dedupeMoviesById(locallyFilteredPool)
    .map((movie) => ({ movie, score: scorePickCandidate(movie, preferences, promptBoosts) }))
    .sort((left, right) => right.score - left.score);

  const topPreliminaryCandidates = preliminaryRanked.slice(0, 28).map((entry) => entry.movie);
  const detailedCandidates = await enrichCandidatesWithDetails(topPreliminaryCandidates);
  const finalRankedCandidates = detailedCandidates
    .filter((movie) => !isLowSignalMovie(movie) && !excludedIds.has(movie.id))
    .map((movie) => ({ movie, score: scorePickCandidate(movie, preferences, promptBoosts) }))
    .sort((left, right) => right.score - left.score);

  const curatedRankingEntries = balanceCandidatesByEra(finalRankedCandidates, 22);
  const rankingPool = curatedRankingEntries.map((entry) => entry.movie);
  const aiRanking = rankingPool.length >= 4 ? await rankCandidatesWithOpenAI(preferences, rankingPool).catch((error) => {
    console.error("OpenAI ranking failed:", error.response?.data || error.message);
    return null;
  }) : null;

  const movieLookup = new Map(rankingPool.map((movie) => [movie.id, movie]));
  const fallbackPrimary = finalRankedCandidates[0]?.movie || null;
  const fallbackBackups = finalRankedCandidates.slice(1, 4).map((entry) => entry.movie);

  const primaryPick = movieLookup.get(aiRanking?.primary?.id) || fallbackPrimary;
  const alternatePicks = (Array.isArray(aiRanking?.backups) ? aiRanking.backups.map((entry) => movieLookup.get(entry.id)).filter(Boolean) : fallbackBackups)
    .filter((movie) => movie?.id && movie.id !== primaryPick?.id)
    .slice(0, 3);

  if (!primaryPick) {
    return {
      label: "Pick for Me",
      summary: buildPickNoMatchSummary(preferences),
      assistant_note: "ReelBot could not find a strong-enough fit from the current candidate pool.",
      resolved_preferences: preferences,
      primary: null,
      alternates: [],
      cached: false,
    };
  }

  const topScore = finalRankedCandidates[0]?.score || 0;
  const payload = {
    label: "Pick for Me",
    summary: aiRanking?.summary || buildPickSuccessSummary(preferences),
    assistant_note: aiRanking?.assistant_note || "ReelBot ranked a fresh pool of candidates, then kept the backups close without making them feel redundant.",
    match_score: aiRanking?.primary?.match_score || buildMatchScore(finalRankedCandidates.find((entry) => entry.movie.id === primaryPick.id)?.score || topScore, topScore),
    resolved_preferences: preferences,
    primary: normalizePickMovie(primaryPick, preferences, {
      reason: aiRanking?.primary?.reason,
      match_score: aiRanking?.primary?.match_score || buildMatchScore(finalRankedCandidates.find((entry) => entry.movie.id === primaryPick.id)?.score || topScore, topScore),
    }),
    alternates: alternatePicks.map((movie, index) => normalizePickMovie(movie, preferences, {
      reason: Array.isArray(aiRanking?.backups) ? aiRanking.backups[index]?.reason : "Strong backup if you want a nearby option that still fits the night.",
      match_score: buildMatchScore(finalRankedCandidates.find((entry) => entry.movie.id === movie.id)?.score || topScore, topScore),
    })),
    candidate_count: candidatePool.length,
    curated_candidate_count: rankingPool.length,
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
    append_to_response: "credits,reviews,similar,videos,watch/providers",
  });

  const genres = Array.isArray(movie.genres) ? movie.genres.map((genre) => genre.name).join(", ") : "Unknown";
  const director = getDirector(movie.credits);
  const reviewHighlights = getReviewHighlights(movie.reviews?.results);
  const similarMovies = (movie.similar?.results || []).slice(0, 5).map((similarMovie) => ({
    title: similarMovie.title,
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
- Return an ordered HTML list with exactly 3 movie recommendations.
- Each item must start with the title in <strong>Title</strong> format.
- Add one sentence explaining why it scratches a similar itch in tone, themes, talent, or scale.
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
- Return an ordered HTML list with exactly 3 movie recommendations.
- Each item must start with the title in <strong>Title</strong> format.
- Add one sentence explaining why it matches in tone, themes, style, pacing, or audience experience.
- Prioritize good fit over obvious franchise adjacency.`;
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
        ? `<ol>${similarMovies
            .slice(0, 3)
            .map(
              (similarMovie) =>
                `<li><strong>${escapeHtml(similarMovie.title)}</strong> — A nearby pick if you want something with a related tone or audience appeal.</li>`
            )
            .join("")}</ol>`
        : `<p>ReelBot could not line up similar picks right now, but the TMDB-based adjacent titles section below is still a good next step.</p>`;
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

const generateReelbotPayload = async (movieId, requestedAction = "quick_take") => {
  const action = normalizeAction(requestedAction);
  const cacheKey = `${movieId}:${action}`;

  if (reelbotCache.has(cacheKey)) {
    return { ...reelbotCache.get(cacheKey), cached: true };
  }

  console.log(`Received ReelBot request for movie ID: ${movieId}, action: ${action}`);

  const context = await getMovieContext(movieId);
  let content = buildFallbackContent(action, context);

  if (OPENAI_API_KEY) {
    try {
      console.log(`Using OpenAI model: ${OPENAI_MODEL}`);
      const systemPrompt = `You are ${AI_NAME}, an AI movie companion inside a calm, premium movie app. Respond with useful viewer guidance using only simple HTML tags: <p>, <ol>, <ul>, <li>, <strong>, <em>, and <br />. Never use markdown or code fences. Never include a top-level heading because the UI already supplies one.`;
      const userPrompt = buildPromptForAction(action, context);
      const aiResponse = await axios.post(
        "https://api.openai.com/v1/responses",
        createOpenAIRequestBody(action, systemPrompt, userPrompt),
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const responseText = extractResponsesText(aiResponse.data);
      if (responseText) {
        content = normalizeRichText(responseText);
      }
    } catch (err) {
      console.error("OpenAI request failed:", err.response?.data || err.message);
    }
  }

  const payload = {
    movie_id: context.movie.id,
    title: context.movie.title,
    action,
    label: REELBOT_ACTIONS[action].label,
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

app.get("/movies/:id", async (req, res) => {
  const movieId = req.params.id;

  try {
    console.log(`Fetching details for movie ID: ${movieId}`);
    const movie = await fetchTmdb(`/movie/${movieId}`, {
      append_to_response: "credits,reviews,similar,videos,watch/providers",
    });

    res.json(normalizeMovieDetails(movie));
  } catch (error) {
    console.error("❌ Error fetching movie details:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch movie details" });
  }
});

const formatDate = (value) => value.toISOString().split("T")[0];

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
    .sort(sortLatestMovies);

const filterPopularResults = (results = []) =>
  results
    .filter((movie) => movie.poster_path)
    .filter((movie) => !movie.adult)
    .sort(sortPopularMovies);

const filterUpcomingResults = (results = []) =>
  results
    .filter((movie) => movie.poster_path)
    .filter((movie) => !movie.adult)
    .filter((movie) => (movie.vote_count || 0) >= 3 || (movie.popularity || 0) >= 15)
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
  const rotatedPage = pageNumber > 1 ? pageNumber : getRotatedPage(normalizedType, 0);
  const results = await fetchFeedBatch(normalizedType, rotatedPage);

  return {
    page: pageNumber,
    total_pages: 500,
    total_results: results.length,
    results,
    source_page: rotatedPage,
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
    return {
      ...payload,
      page: pageNumber,
      results: sortDiscoveryResults(normalizedType, payload.results),
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
      .flatMap((response) => sortDiscoveryResults(normalizedType, response.value.results))
  );
  const totalPages = responses.find((response) => response.status === "fulfilled")?.value?.total_pages || 1;

  return {
    page: 1,
    total_pages: totalPages,
    total_results: collected.length,
    results: collected.slice(0, minimumCount),
  };
};

const buildPickFallbackPayload = (rawPreferences = {}, message) => {
  const preferences = resolvePickPreferences(rawPreferences);
  const summary = message || buildPickErrorSummary(preferences);

  return {
    label: "Pick for Me",
    summary,
    resolved_preferences: preferences,
    primary: null,
    alternates: [],
    cached: false,
    degraded: true,
  };
};

app.get("/movies", async (req, res) => {
  const { type = "latest", page = 1, genre = "", runtime = "any", fill = 0 } = req.query;
  const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
  const normalizedType = normalizeDiscoveryView(type);

  try {
    const payload = await fetchFilledDiscoverResults(normalizedType, pageNumber, {
      genre: genre || undefined,
      runtime,
    }, fill);

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

app.get("/search", async (req, res) => {
  const { query, page = 1 } = req.query;

  if (!query) {
    return res.status(400).json({ error: "Search query is required" });
  }

  try {
    const response = await axios.get(
      `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=en-US&query=${query}&page=${page}`
    );
    res.json(response.data);
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
    res.json(buildPickFallbackPayload(req.body || {}));
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

  if (!hasExplicitUserTrigger(req)) {
    return res.status(400).json({
      error: "ReelBot requests must come from an explicit user click.",
    });
  }

  try {
    const payload = await generateReelbotPayload(movieId, action);
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
