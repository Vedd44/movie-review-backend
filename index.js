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
  top_cast: Array.isArray(movie.credits?.cast)
    ? movie.credits.cast.slice(0, 5).map((castMember) => castMember.name)
    : [],
  poster_path: movie.poster_path || null,
  backdrop_path: movie.backdrop_path || null,
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
  const safeTitle = escapeHtml(movie.title);
  const safeOverview = escapeHtml(movie.overview || "No description available.");
  const safeGenres = escapeHtml(genres);
  const safeDirector = escapeHtml(director);
  const lowerGenres = safeGenres.toLowerCase();

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
      append_to_response: "credits,similar",
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
    .sort(sortLatestMovies);

const filterPopularResults = (results = []) =>
  results
    .filter((movie) => movie.poster_path)
    .sort(sortPopularMovies);

const filterUpcomingResults = (results = []) =>
  results
    .filter((movie) => movie.poster_path)
    .filter((movie) => (movie.vote_count || 0) >= 3 || (movie.popularity || 0) >= 15)
    .sort(sortUpcomingMovies);

app.get("/movies", async (req, res) => {
  const { type = "latest", page = 1 } = req.query;
  const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);

  const todayDate = new Date();
  const today = formatDate(todayDate);
  const oneMonthAgo = new Date(todayDate);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const formattedOneMonthAgo = formatDate(oneMonthAgo);
  const tomorrow = new Date(todayDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const formattedTomorrow = formatDate(tomorrow);
  const sixMonthsOut = new Date(todayDate);
  sixMonthsOut.setMonth(sixMonthsOut.getMonth() + 6);
  const formattedSixMonthsOut = formatDate(sixMonthsOut);

  try {
    let payload;

    if (type === "popular") {
      payload = await fetchTmdb("/discover/movie", {
        region: "US",
        include_adult: "false",
        sort_by: "popularity.desc",
        "primary_release_date.lte": today,
        "release_date.lte": today,
        with_release_type: "2|3",
        with_original_language: "en",
        "vote_count.gte": 120,
        "vote_average.gte": 5.5,
        without_genres: "99,10770",
        page: pageNumber,
      });

      payload = {
        ...payload,
        results: filterPopularResults(payload.results),
      };
    } else if (type === "upcoming") {
      payload = await fetchTmdb("/discover/movie", {
        region: "US",
        include_adult: "false",
        sort_by: "popularity.desc",
        "primary_release_date.gte": formattedTomorrow,
        "primary_release_date.lte": formattedSixMonthsOut,
        "release_date.gte": formattedTomorrow,
        "release_date.lte": formattedSixMonthsOut,
        with_release_type: "2|3",
        with_original_language: "en",
        without_genres: "99,10770",
        page: pageNumber,
      });

      payload = {
        ...payload,
        results: filterUpcomingResults(payload.results),
      };
    } else {
      payload = await fetchTmdb("/discover/movie", {
        region: "US",
        include_adult: "false",
        sort_by: "primary_release_date.desc",
        "primary_release_date.gte": formattedOneMonthAgo,
        "primary_release_date.lte": today,
        "release_date.gte": formattedOneMonthAgo,
        "release_date.lte": today,
        with_release_type: "2|3",
        with_original_language: "en",
        "vote_count.gte": 15,
        "vote_average.gte": 5,
        without_genres: "99,10770",
        page: pageNumber,
      });

      payload = {
        ...payload,
        results: filterLatestResults(payload.results),
      };
    }

    res.json(payload);
  } catch (error) {
    console.error(`❌ Error fetching ${type} movies:`, error.response?.data || error.message);
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
