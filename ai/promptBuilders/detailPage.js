const { getPrinciplesText } = require("../reelbotPrinciples");
const { getVoiceText } = require("../reelbotVoice");

const compactContext = (context = {}) => ({
  movie: {
    id: context.movie?.id,
    title: context.movie?.title,
    release_date: context.movie?.release_date,
    status: context.movie?.status,
    runtime: context.movie?.runtime,
    tagline: context.movie?.tagline,
    overview: context.movie?.overview,
    vote_average: context.movie?.vote_average,
  },
  genres: context.genres,
  director: context.director,
  top_cast: context.topCast,
  review_highlights: {
    positive: context.topReview?.content || "",
    negative: context.bottomReview?.content || "",
  },
  adjacent_titles: Array.isArray(context.similarMovies) ? context.similarMovies.map((movie) => movie.title) : [],
});

const compactIntent = (intent = null) => {
  if (!intent || typeof intent !== "object") {
    return null;
  }

  return {
    raw_prompt: intent.raw_prompt,
    tone: intent.tone,
    emotional_weight: intent.emotional_weight,
    pacing: intent.pacing,
    accessibility: intent.accessibility,
    energy_level: intent.energy_level,
    audience: intent.audience,
    watch_context: intent.watch_context,
    avoidance_signals: intent.avoidance_signals,
    guardrails: intent.guardrails,
    rubric_keys: intent.rubric_keys,
  };
};

const DETAIL_ACTION_GUIDES = {
  quick_take: "Answer: what does this feel like, and who is it for?",
  is_this_for_me: "Answer: who will like this, and who may not?",
  why_watch: "Answer: what does this movie specifically do well?",
  best_if_you_want: "Answer with short, concrete decision bullets tied to tone, pacing, commitment, and genre appeal.",
  similar_picks: "Answer with intentional next-watch roles such as safer, darker, stranger, or more action-forward.",
  scary_check: "Separate scary from merely tense or intense.",
  pace_check: "Describe pace, attention cost, and whether it is plot-driven or mood-driven.",
  best_mood: "Describe the best mindset and viewing setup.",
  date_night: "Judge shared-watch viability without hype.",
  spoiler_synopsis: "Summarize the movie clearly for someone who wants the full story.",
  ending_explained: "Explain the ending plainly, then what it means.",
  themes_and_takeaways: "Name the central themes, not generic motifs.",
  debate_club: "Surface actual tradeoffs or ambiguities people debate.",
};

const buildDetailPrompts = ({ action, context, previewMode = false, requestMeta = {} }) => {
  const spoilerMode = requestMeta.spoiler_mode === true;
  const useCase = typeof requestMeta.use_case === "string" && requestMeta.use_case.trim() ? requestMeta.use_case.trim() : action;
  const promptTemplate = typeof requestMeta.prompt_template === "string" && requestMeta.prompt_template.trim()
    ? requestMeta.prompt_template.trim()
    : previewMode
      ? "detail_preview"
      : spoilerMode
        ? "detail_spoiler"
        : "detail_standard";

  return {
    systemPrompt: [
      `You are ReelBot's Detail Page Assistant.`,
      getPrinciplesText(),
      getVoiceText(),
      "Role rules:",
      "- Stay grounded in the specific movie provided.",
      "- Be spoiler-light unless the action explicitly asks for spoilers.",
      "- If a user vibe or intent is provided, judge the movie against that vibe instead of giving a generic answer.",
      previewMode
        ? "- If the movie is unreleased, treat this as an informed preview rather than a finished-view verdict."
        : "- Use the available movie context to help the viewer decide whether and how to watch.",
    ].join("\n\n"),
    userPrompt: [
      `Action: ${action}`,
      `Guide: ${DETAIL_ACTION_GUIDES[action] || DETAIL_ACTION_GUIDES.quick_take}`,
      `Preview mode: ${previewMode ? "yes" : "no"}`,
      `Spoiler mode: ${spoilerMode ? "on" : "off"}`,
      `Prompt template: ${promptTemplate}`,
      `Requested use case: ${useCase}`,
      `User prompt: ${requestMeta.user_prompt || "none"}`,
      `User intent: ${JSON.stringify(compactIntent(requestMeta.intent_snapshot))}`,
      `Movie context: ${JSON.stringify(compactContext(context))}`,
      "Write only the structured fields required by the schema.",
    ].join("\n\n"),
  };
};

module.exports = {
  buildDetailPrompts,
};
