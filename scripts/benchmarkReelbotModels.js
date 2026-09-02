const API_BASE = process.env.REELBOT_BENCHMARK_API || "http://127.0.0.1:5001";

const cases = [
  {
    name: "by_any_means_cast_question",
    path: "/reelbot/ask",
    body: { prompt: "who's in the movie?", page_context: { page: "movie_detail", movie: { id: 1380417, title: "By Any Means" } } },
    validate: (payload) => payload.kind === "answer"
      && payload.intent === "CURRENT_MOVIE_QUESTION"
      && /Mark Wahlberg|Yahya Abdul-Mateen/i.test(payload.answer || "")
      && !/I can (?:check|search|look)/i.test(payload.answer || "")
      && !payload.recommendation,
  },
  {
    name: "coyote_current_movie_question",
    path: "/reelbot/ask",
    body: { prompt: "is this movie scary?", page_context: { page: "movie_detail", movie: { id: 1204680, title: "Coyote vs. Acme" } } },
    validate: (payload) => payload.kind === "answer" && payload.intent === "CURRENT_MOVIE_QUESTION" && !payload.recommendation,
  },
  {
    name: "alien_less_scary_alternative",
    path: "/reelbot/ask",
    body: { prompt: "something like this but less scary", page_context: { page: "movie_detail", movie: { id: 348, title: "Alien" }, activeConstraints: { includeTheatrical: false } } },
    validate: (payload) => payload.kind === "recommendation" && payload.intent === "MOVIE_RECOMMENDATION" && payload.recommendation?.primary?.id !== 348,
  },
  {
    name: "paddington_child_question",
    path: "/reelbot/ask",
    body: { prompt: "is this good for a 5 year old?", page_context: { page: "movie_detail", movie: { id: 346648, title: "Paddington 2" } } },
    validate: (payload) => payload.kind === "answer" && payload.intent === "CURRENT_MOVIE_QUESTION" && !payload.recommendation,
  },
  {
    name: "two_movie_comparison",
    path: "/reelbot/ask",
    body: { prompt: "should I watch this or Alien?", page_context: { page: "movie_detail", movie: { id: 346648, title: "Paddington 2" } } },
    validate: (payload) => payload.kind === "answer"
      && payload.intent === "MOVIE_COMPARISON"
      && /Paddington 2/i.test(payload.answer || "")
      && /Alien/i.test(payload.answer || "")
      && !payload.recommendation,
  },
];

const post = async (entry) => {
  const startedAt = Date.now();
  const response = await fetch(`${API_BASE}${entry.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-ReelBot-Trigger": "user_click" },
    body: JSON.stringify({ trigger: "user_click", ...entry.body }),
  });
  const payload = await response.json();
  return {
    name: entry.name,
    status: response.status,
    passed: response.ok && entry.validate(payload),
    latency_ms: Date.now() - startedAt,
    reported_latency_ms: payload.latency_ms || null,
    model: payload.model || null,
    intent: payload.intent || null,
    kind: payload.kind || null,
    answer: payload.answer || null,
    primary: payload.recommendation?.primary?.title || null,
    error: payload.error || null,
  };
};

(async () => {
  const results = [];
  for (const entry of cases) results.push(await post(entry));
  console.log(JSON.stringify({ api: API_BASE, generated_at: new Date().toISOString(), results }, null, 2));
  if (results.some((entry) => !entry.passed)) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
