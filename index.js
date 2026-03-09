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
};

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

const normalizeMovieDetails = (movie) => ({
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
  poster_path: movie.poster_path || null,
  backdrop_path: movie.backdrop_path || null,
  similar: Array.isArray(movie.similar?.results)
    ? movie.similar.results.slice(0, 6).map((similarMovie) => ({
        id: similarMovie.id,
        title: similarMovie.title,
        release_date: similarMovie.release_date || "",
        poster_path: similarMovie.poster_path || null,
      }))
    : [],
});

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
    append_to_response: "credits,reviews,similar",
  });

  const genres = Array.isArray(movie.genres) ? movie.genres.map((genre) => genre.name).join(", ") : "Unknown";
  const director = getDirector(movie.credits);
  const reviews = movie.reviews?.results || [];
  const topReview = reviews[0] || null;
  const bottomReview = reviews.length > 1 ? reviews[reviews.length - 1] : null;
  const similarMovies = (movie.similar?.results || []).slice(0, 5).map((similarMovie) => ({
    title: similarMovie.title,
    overview: similarMovie.overview || "",
  }));
  const topCast = (movie.credits?.cast || []).slice(0, 5).map((castMember) => castMember.name).join(", ");

  return {
    movie,
    genres,
    director,
    topReview,
    bottomReview,
    similarMovies,
    topCast,
  };
};

const buildContextBlock = (context) => {
  const { movie, genres, director, topReview, bottomReview, similarMovies, topCast } = context;

  return [
    `Title: ${movie.title}`,
    `Release year: ${movie.release_date ? new Date(movie.release_date).getFullYear() : "Unknown"}`,
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
  const safeTitle = escapeHtml(movie.title);
  const safeOverview = escapeHtml(movie.overview || "No description available.");
  const safeGenres = escapeHtml(genres);
  const safeDirector = escapeHtml(director);

  switch (action) {
    case "is_this_for_me":
      return `
        <p><strong>Best for:</strong> Viewers in the mood for ${safeGenres.toLowerCase()} with a clearly defined creative point of view.</p>
        <p><strong>Maybe not for:</strong> Anyone looking for a purely passive, low-attention watch may want something more straightforward.</p>
        <p><strong>Vibe check:</strong> ${safeTitle} looks like the kind of movie you choose when you want a specific tone, not just background noise.</p>
      `;
    case "why_watch":
      return `
        <ol>
          <li><strong>Distinct tone</strong> — ${safeTitle} blends ${safeGenres.toLowerCase()} into a clear viewing identity.</li>
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
        : `<p>ReelBot could not line up similar picks right now, but the TMDB-based "More Like This" section below is still a good next step.</p>`;
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
      append_to_response: "credits,similar",
    });

    res.json(normalizeMovieDetails(movie));
  } catch (error) {
    console.error("❌ Error fetching movie details:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch movie details" });
  }
});

app.get("/movies", async (req, res) => {
  const { type = "latest", page = 1 } = req.query;
  let tmdbEndpoint;

  const today = new Date().toISOString().split("T")[0];
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const formattedOneMonthAgo = oneMonthAgo.toISOString().split("T")[0];

  if (type === "popular") {
    tmdbEndpoint = `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_API_KEY}&language=en-US&region=US&page=${page}`;
  } else if (type === "upcoming") {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const formattedTomorrow = tomorrow.toISOString().split("T")[0];

    tmdbEndpoint = `https://api.themoviedb.org/3/movie/upcoming?api_key=${TMDB_API_KEY}&language=en-US&region=US&primary_release_date.gte=${formattedTomorrow}&page=${page}`;
  } else {
    tmdbEndpoint = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=en-US&region=US&sort_by=primary_release_date.desc&primary_release_date.gte=${formattedOneMonthAgo}&primary_release_date.lte=${today}&with_release_type=3|2&without_keywords=12345,67890&without_genres=99,10770&page=${page}`;
  }

  console.log(`Fetching movies from: ${tmdbEndpoint}`);

  try {
    const response = await axios.get(tmdbEndpoint);
    res.json(response.data);
  } catch (error) {
    console.error(`❌ Error fetching ${type} movies:`, error);
    res.status(500).json({ error: `Failed to fetch ${type} movies` });
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
