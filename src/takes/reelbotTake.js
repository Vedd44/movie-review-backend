const crypto = require("node:crypto");

const REELBOT_TAKE_VERSION = "v4";
const REELBOT_TAKE_FIELDS = ["assessment", "good_fit_if", "maybe_not_if"];

const reelbotTakeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    assessment: { type: "string" },
    good_fit_if: { type: "string" },
    maybe_not_if: { type: "string" },
  },
  required: REELBOT_TAKE_FIELDS,
};

const compact = (value = "") => String(value || "").replace(/\s+/g, " ").trim();
const wordCount = (value = "") => compact(value).split(/\s+/).filter(Boolean).length;
const isPlainEditorialText = (value = "") => {
  const text = compact(value);
  return Boolean(text)
    && !/[#*_`<>]/.test(text)
    && !/^(?:assessment|good fit if|maybe not if)\s*:/i.test(text);
};

const validateReelbotTake = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !REELBOT_TAKE_FIELDS.includes(key))) return null;

  const take = Object.fromEntries(REELBOT_TAKE_FIELDS.map((field) => [field, compact(value[field])]));
  if (!REELBOT_TAKE_FIELDS.every((field) => isPlainEditorialText(take[field]))) return null;
  if (wordCount(take.assessment) < 12 || wordCount(take.assessment) > 75) return null;
  if (wordCount(take.good_fit_if) < 6 || wordCount(take.good_fit_if) > 40) return null;
  if (wordCount(take.maybe_not_if) < 6 || wordCount(take.maybe_not_if) > 40) return null;
  return take;
};

const compactObject = (value) => {
  if (Array.isArray(value)) {
    const items = value.map(compactObject).filter((entry) => entry !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, entry]) => [key, compactObject(entry)])
      .filter(([, entry]) => entry !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  if (typeof value === "string") return compact(value) || undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  return undefined;
};

const buildTakeGrounding = (movie = {}) => compactObject({
  title: movie.title,
  release_year: movie.release_year,
  overview: movie.description,
  tagline: movie.tagline,
  runtime_minutes: movie.runtime,
  genres: movie.genre_names,
  keywords_and_themes: (movie.keyword_names || []).slice(0, 18),
  director: movie.director,
  principal_cast: (movie.top_cast || []).slice(0, 4),
  certification: movie.certification,
  consensus: movie.vote_count >= 100 ? {
    tmdb_rating: movie.rating,
    vote_count: movie.vote_count,
  } : undefined,
  audience_signals: movie.audience_signals,
  content_signals: movie.content_signals,
  watch_signals: movie.watch_signals,
});

const buildTakePrompts = (movie = {}) => {
  const grounding = buildTakeGrounding(movie);
  return {
    systemPrompt: [
      "You are ReelBot, a sharp movie concierge helping someone decide what to watch tonight.",
      "Characterize the experience of watching this specific movie; do not summarize it, review it, score it, or translate its genres into prose.",
      "Interpret the supplied facts. Explain what distinguishes this watch, what it asks of the viewer, who or what kind of night it suits, and the most meaningful reason to choose something else tonight.",
      "Prioritize tone, pacing, emotional character, intensity, scale, humor, accessibility, narrative style, intellectual demands, viewing commitment, and distinctive qualities only where the supplied context supports them.",
      "Derived audience, content, and watch signals are approximate retrieval aids, not authoritative facts. Reconcile them with the overview, keywords, certification, runtime, and genres; ignore a derived label when those sources do not support it.",
      "Do not claim a movie is background-friendly, appropriate for toddlers, frightening, gentle, confusing, or easy solely because a derived signal says so.",
      "Mention runtime only when it meaningfully shapes the viewing decision, and express it naturally, such as nearly three hours, just over two hours, or a brisk 90 minutes rather than defaulting to an exact minute count. Plot details belong only when they clarify the experience.",
      "Be willing to name tradeoffs. Maybe-not-if is a viewing-context mismatch, not a criticism section.",
      "Never invent plot events, relationships, themes, production facts, awards, reception, cast, runtime, or certification.",
      "If evidence is thin, be restrained instead of filling gaps.",
      "Avoid generic praise, marketing language, first person, scores, markdown, headings, and phrases such as fans of, viewers seeking, audiences who appreciate, this film offers, compelling blend, captivating, engaging, thought-provoking, or intelligent-feeling.",
      "Start the assessment directly with the movie or its viewing experience, using its distinctive tone, scale, pacing, emotional character, or a meaningful relationship among those qualities. Do not default to framing the viewer's act of selecting it: avoid openings such as Choosing [movie] means, Choosing this means, Settling into [movie] means, or This means committing to. Vary sentence structure rather than replacing them with another rigid opening template.",
      "Avoid field-by-field boilerplate: do not habitually begin good_fit_if with Pick it. The UI already supplies Good fit if and Maybe not if labels; make each value read naturally beneath its label, usually addressing the viewer as you. Begin maybe_not_if with the mismatch itself rather than commands such as Skip it tonight, Avoid it, or Choose something else.",
      "Write concise, confident, conversational, movie-literate editorial prose. Vary sentence structure naturally.",
      "Assessment is normally 25–55 words in one or two sentences. Good fit if and maybe not if are each one sentence, normally 12–30 words.",
      "Return only the required structured fields.",
    ].join("\n"),
    userPrompt: `Grounded movie context:\n${JSON.stringify(grounding, null, 2)}\n\nWrite ReelBot's Take to help someone decide whether this particular movie fits tonight. Talk directly about the movie and its viewing experience.`,
  };
};

const buildTakeContextHash = (movie = {}) => crypto
  .createHash("sha256")
  .update(JSON.stringify(buildTakeGrounding(movie)))
  .digest("hex");

const buildRestrainedTakeFallback = (movie = {}) => {
  const title = compact(movie.title) || "This movie";
  const runtime = Number(movie.runtime || 0);
  return {
    assessment: `ReelBot’s fuller viewing read for ${title} is temporarily unavailable.${runtime ? ` It runs ${runtime} minutes, so use the premise and details below to judge whether that commitment fits tonight.` : " Use the premise and details below to judge whether it fits tonight."}`,
    good_fit_if: "You already know the premise is the kind of experience you want tonight.",
    maybe_not_if: "You need a more specific read on tone, intensity, or commitment before deciding.",
  };
};

const createReelbotTakeService = ({
  generateTake,
  persistentStore = null,
  model = "",
  version = REELBOT_TAKE_VERSION,
  memoryCache = new Map(),
} = {}) => {
  const inFlight = new Map();
  const getTake = async (movie = {}) => {
    const movieId = Number(movie.id);
    const contextHash = buildTakeContextHash(movie);
    const cacheKey = `reelbot_take:${version}:${movieId}:${contextHash}`;
    const memoryTake = validateReelbotTake(memoryCache.get(cacheKey)?.take);
    if (memoryTake) return { take: memoryTake, source: "memory_cache", version, model };
    if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

    const pending = (async () => {
      if (persistentStore?.get && movieId) {
        try {
          const stored = await persistentStore.get({ movieId, version });
          const storedTake = stored?.context_hash === contextHash ? validateReelbotTake(stored.take) : null;
          if (storedTake) {
            memoryCache.set(cacheKey, { take: storedTake });
            return { take: storedTake, source: "persistent_cache", version, model: stored.model || model };
          }
        } catch (error) {
          // Persistence is an optimization. Generation and fallback remain available.
        }
      }

      try {
        const generatedTake = validateReelbotTake(await generateTake?.(movie));
        if (!generatedTake) throw new Error("invalid_take");
        memoryCache.set(cacheKey, { take: generatedTake });
        if (persistentStore?.set && movieId) {
          try {
            await persistentStore.set({ movieId, version, contextHash, take: generatedTake, model });
          } catch (error) {
            // Keep serving the validated in-memory result if durable storage is unavailable.
          }
        }
        return { take: generatedTake, source: "generated", version, model };
      } catch (error) {
        return { take: buildRestrainedTakeFallback(movie), source: "fallback", version, model };
      }
    })();

    inFlight.set(cacheKey, pending);
    try {
      return await pending;
    } finally {
      inFlight.delete(cacheKey);
    }
  };

  return { getTake };
};

module.exports = {
  REELBOT_TAKE_VERSION,
  reelbotTakeSchema,
  validateReelbotTake,
  buildTakeGrounding,
  buildTakePrompts,
  buildTakeContextHash,
  buildRestrainedTakeFallback,
  createReelbotTakeService,
};
