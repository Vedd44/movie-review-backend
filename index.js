const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // ✅ No hardcoded key
const TMDB_API_KEY = process.env.TMDB_API_KEY;

app.get("/", (req, res) => {
  res.send("Movie Review Backend is Running!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
