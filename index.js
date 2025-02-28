require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5001;

// ✅ Use environment variables for API keys
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// ✅ Allow frontend to access the backend
app.use(cors());
app.use(express.json());

// ✅ Test Route
app.get("/", (req, res) => {
  res.send("Movie Review Backend is Running!");
});

app.get("/movies/:id", async (req, res) => {
  const movieId = req.params.id;

  try {
    console.log(`Fetching details for movie ID: ${movieId}`);

    const response = await axios.get(
      `https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}&language=en-US`
    );

    console.log("✅ Movie Data:", response.data);
    res.json(response.data);
  } catch (error) {
    console.error("❌ Error fetching movie details:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch movie details" });
  }
});


app.get("/movies", async (req, res) => {
  const { type = "latest", page = 1 } = req.query;
  let tmdbEndpoint;

  const today = new Date().toISOString().split("T")[0]; // Get today's date in YYYY-MM-DD format
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const formattedOneMonthAgo = oneMonthAgo.toISOString().split("T")[0];

  if (type === "popular") {
    // ✅ Fetch popular movies
    tmdbEndpoint = `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_API_KEY}&language=en-US&region=US&page=${page}`;
  } else if (type === "upcoming") {
    // ✅ Fetch only future US-based releases (starting tomorrow)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const formattedTomorrow = tomorrow.toISOString().split("T")[0];

    tmdbEndpoint = `https://api.themoviedb.org/3/movie/upcoming?api_key=${TMDB_API_KEY}&language=en-US&region=US&primary_release_date.gte=${formattedTomorrow}&page=${page}`;
  } else {
    // ✅ Fetch only US-based latest movies from the past month
    tmdbEndpoint = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=en-US&region=US
  &sort_by=primary_release_date.desc
  &primary_release_date.gte=${formattedOneMonthAgo}
  &primary_release_date.lte=${today}
  &with_release_type=3|2  // ✅ Only includes theatrical and digital releases
  &without_keywords=12345,67890  // ✅ (Optional) Filter out known bad keywords like "UFC"
  &without_genres=99,10770`;  // ✅ Exclude documentaries & TV movies

  }

  console.log(`Fetching movies from: ${tmdbEndpoint}`); // ✅ Debugging API request

  try {
    const response = await axios.get(tmdbEndpoint);
    res.json(response.data);
  } catch (error) {
    console.error(`❌ Error fetching ${type} movies:`, error);
    res.status(500).json({ error: `Failed to fetch ${type} movies` });
  }
});




// ✅ Search Movies
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

// ✅ Fetch AI Summary from OpenAI
app.get("/movies/:id/ai-summary", async (req, res) => {
  const movieId = req.params.id;
  const AI_NAME = "ReelBot";

  try {
    // Fetch Movie Details
    const movieResponse = await axios.get(
      `https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}`
    );
    const movie = movieResponse.data;
    const genres = movie.genres.map((g) => g.name).join(", ");

    // Fetch Director
    const directorResponse = await axios.get(
      `https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${TMDB_API_KEY}`
    );
    const director = directorResponse.data.crew.find((crew) => crew.job === "Director")?.name || "Unknown";

    // Fetch Reviews
    const reviewsResponse = await axios.get(
      `https://api.themoviedb.org/3/movie/${movieId}/reviews?api_key=${TMDB_API_KEY}`
    );
    const reviews = reviewsResponse.data.results;
    const topReview = reviews.length > 0 ? reviews[0] : null;
    const bottomReview = reviews.length > 1 ? reviews[reviews.length - 1] : null;

    // Fetch Similar Movies
    const similarMoviesResponse = await axios.get(
      `https://api.themoviedb.org/3/movie/${movieId}/similar?api_key=${TMDB_API_KEY}`
    );
    const similarMovies = similarMoviesResponse.data.results.slice(0, 3).map((m) => m.title).join(", ");

    // AI Request for Summary, Recommendations & Mood Tags
    const aiResponse = await axios.post(
  "https://api.openai.com/v1/chat/completions",
  {
    model: "gpt-4-turbo",
    messages: [
      { role: "system", content: `You are ${AI_NAME}, a movie AI expert that provides insights, recommendations, and mood-based tags. Your responses should be well-formatted with proper paragraph breaks and bullet points for lists.` },
      { 
        role: "user", 
        content: `Hey ${AI_NAME}, analyze '${movie.title}' and provide:

        - A **brief summary** of the movie. Keep it vague but entertaining. Use paragraph breaks for readability.
        - If someone liked '${movie.title}', suggest three similar movies in **list format** with proper spacing between each.

        **Movie Details:**
        - **Genre:** ${genres}
        - **Director:** ${director}
        - **Best Review:** ${topReview ? topReview.content : "No review available"}
        - **Worst Review:** ${bottomReview ? bottomReview.content : "No review available"}
        - **Similar Movies:** ${similarMovies}

        **Important Formatting Instructions:**
        - Use paragraph breaks (\n\n) between sections.
        - Present movie recommendations in **numbered list format** with a short description.
        - Do **not** include "### Brief Summary of '${movie.title}'" in your response.
        - Avoid unnecessary filler words. Keep it concise yet engaging.
        `
      }
    ],
    max_tokens: 350,
  },
  {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
  }
);


    // Extract AI-generated Summary & Mood Tags Correctly
    const aiSummary = aiResponse.data.choices[0].message.content;

    // ✅ Properly Extract Mood Tags (Ensure They're Three One-Word Tags)
    const moodTagsMatch = aiSummary.match(/- (\w+)/g);
    const moodTags = moodTagsMatch ? moodTagsMatch.map(tag => tag.replace("- ", "").trim()).slice(0, 3) : [];

    // ✅ Send Final Response
    res.json({
      summary: aiSummary,
      ai_name: AI_NAME,
      genre: genres,
      director: director,
      mood_tags: moodTags,
      top_review: topReview?.content ?? "No review available.",
      top_review_author: topReview?.author ?? "Unknown",
      top_review_url: topReview?.url ?? null,
      bottom_review: bottomReview?.content ?? "No review available.",
      bottom_review_author: bottomReview?.author ?? "Unknown",
      bottom_review_url: bottomReview?.url ?? null,
      recommendations: similarMovies,
    });
  } catch (error) {
    console.error("Error generating AI summary:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to generate AI summary" });
  }
});

// ✅ Start the Server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
