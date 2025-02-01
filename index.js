require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

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

// ✅ Fetch Latest Movies from TMDB
app.get("/movies/latest", async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_API_KEY}&language=en-US&page=1`
    );
    res.json(response.data.results);
  } catch (error) {
    console.error("Error fetching latest movies:", error);
    res.status(500).json({ error: "Failed to fetch latest movies" });
  }
});

// ✅ Fetch AI Summary from OpenAI
app.get("/movies/:id/ai-summary", async (req, res) => {
  const movieId = req.params.id;

  try {
    // Fetch reviews for the movie
    const reviewsResponse = await axios.get(
      `https://api.themoviedb.org/3/movie/${movieId}/reviews?api_key=${TMDB_API_KEY}`
    );

    const reviews = reviewsResponse.data.results;
    if (reviews.length === 0) {
      return res.status(404).json({ error: "No reviews found" });
    }

    const topReview = reviews[0].content;
    const bottomReview = reviews[reviews.length - 1].content;

    // Call OpenAI API for AI summary
    const aiResponse = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: "You are a movie review assistant." },
          { role: "user", content: `Summarize this movie based on its best and worst reviews:\n\nTop Review: ${topReview}\n\nBottom Review: ${bottomReview}\n\nAlso, recommend it to people who liked X, Y, Z movies.` }
        ],
        max_tokens: 200,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json({
      summary: aiResponse.data.choices[0].message.content,
      top_review: topReview,
      bottom_review: bottomReview,
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
