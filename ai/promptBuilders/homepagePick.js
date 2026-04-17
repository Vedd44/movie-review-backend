const { getFullReelbotFrameworkText } = require("../reelbotPrinciples");
const { RUBRICS } = require("../recommendationRubrics");

const stableStringify = (value) => {
  if (value instanceof Set) {
    return stableStringify(Array.from(value));
  }

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

const buildRubricBlock = (intent = {}) => {
  const rubricKeys = Array.isArray(intent.rubric_keys) ? intent.rubric_keys : [];
  if (!rubricKeys.length) {
    return "No special rubric matched.";
  }

  return rubricKeys
    .map((key) => {
      const rubric = RUBRICS[key];
      if (!rubric) {
        return null;
      }

      return `${rubric.label}: reward ${rubric.reward.join(", ")}; avoid ${rubric.avoid.join(", ")}.`;
    })
    .filter(Boolean)
    .join("\n");
};

const buildUserPreferenceBlock = (preferences = {}) => {
  const profile = preferences.behavioral_memory?.userProfile || {};
  const likedGenres = Array.isArray(profile.likedGenres) ? profile.likedGenres.join(", ") : "";
  const dislikedGenres = Array.isArray(profile.dislikedGenres) ? profile.dislikedGenres.join(", ") : "";
  const preferredPace = Array.isArray(profile.preferredTraits?.pace) ? profile.preferredTraits.pace.join(", ") : "";
  const preferredTone = Array.isArray(profile.preferredTraits?.tone) ? profile.preferredTraits.tone.join(", ") : "";
  const preferredRuntime = Array.isArray(profile.preferredTraits?.runtime) ? profile.preferredTraits.runtime.join(", ") : "";
  const avoidPace = Array.isArray(profile.avoidTraits?.pace) ? profile.avoidTraits.pace.join(", ") : "";
  const avoidTone = Array.isArray(profile.avoidTraits?.tone) ? profile.avoidTraits.tone.join(", ") : "";
  const avoidRuntime = Array.isArray(profile.avoidTraits?.runtime) ? profile.avoidTraits.runtime.join(", ") : "";
  const recentTitles = Array.isArray(profile.recentlyViewed) ? profile.recentlyViewed.map((entry) => entry?.title).filter(Boolean).slice(0, 4).join(", ") : "";
  const hardAvoidIds = profile.hardAvoidMovieIds instanceof Set
    ? Array.from(profile.hardAvoidMovieIds).join(", ")
    : Array.isArray(profile.hardAvoidMovieIds)
      ? profile.hardAvoidMovieIds.join(", ")
      : "";

  if (!likedGenres && !dislikedGenres && !preferredPace && !preferredTone && !preferredRuntime && !recentTitles && !hardAvoidIds) {
    return "No meaningful user preference signals yet.";
  }

  return [
    `Tends to enjoy genres: ${likedGenres || "none yet"}`,
    `Avoid genres: ${dislikedGenres || "none yet"}`,
    `Preferred pace/tone/runtime: ${[preferredPace, preferredTone, preferredRuntime].filter(Boolean).join(" | ") || "none yet"}`,
    `Avoid pace/tone/runtime: ${[avoidPace, avoidTone, avoidRuntime].filter(Boolean).join(" | ") || "none yet"}`,
    `Recently interacted with: ${recentTitles || "none yet"}`,
    `Do not recommend hidden titles: ${hardAvoidIds || "none"}`,
  ].join("\n");
};

const buildPickRankerPrompts = ({ preferences, intent, candidates }) => {
  const candidateBlock = candidates.map((movie) => stableStringify(movie)).join("\n");

  return {
    systemPrompt: [
      `You are ReelBot's Candidate Ranker.`,
      getFullReelbotFrameworkText(),
      "Role rules:",
      "- Do not write user-facing copy.",
      "- Rank only from the provided candidate ids.",
      "- Never infer or reference movies outside the provided candidate pool.",
      "- Treat audience, tone, safety, and explicit exclusions as hard filters before ranking.",
      "- Treat explicit release-year and release-decade constraints as hard filters unless the parsed intent already marks a fallback state.",
      "- Honor the parsed intent lane more than generic popularity.",
      "- Treat the user's moment as the real target, not just broad genre similarity.",
      "- Distinguish the safest strong fit from the most interesting strong fit when they are not the same movie.",
      "- Use the provided derived signals and fit summaries; do not redo discovery from scratch.",
      "- Backup choices must stay in the same high-level lane while varying role.",
    ].join("\n\n"),
    userPrompt: [
      `Resolved preferences: ${stableStringify(preferences)}`,
      `Parsed intent: ${stableStringify(intent)}`,
      `User preference signals:\n${buildUserPreferenceBlock(preferences)}`,
      `Matched rubrics:\n${buildRubricBlock(intent)}`,
      `Candidate pool:\n${candidateBlock}`,
      "Task:",
      "1. Choose exactly 1 top pick and 4 backup picks.",
      "2. Preserve the original lane for anchor prompts, title-similarity prompts, and swap requests.",
      "3. Reject candidates that miss explicit year/decade, audience, tone, safety, or exclusion constraints before you rank anything else.",
      "4. Reward audience fit, context fit, tone fit, pacing fit, emotional fit, accessibility fit, prompt fidelity, and non-obviousness.",
      "5. Prefer clear fit tradeoffs over prestige language or famous defaults.",
      "6. If the best available option is only a partial fit, keep it inside the lane and let the backups cover adjacent safe or interesting angles.",
      "6a. Do not return a de facto no-pick if one or more candidates already have strong_fit or decent_fit evidence.",
      "7. When the prompt contains situational context such as kids, parents, low-stress, background watch, immersive, awards, or country/location intent, let that context outrank vague semantic similarity.",
      "8. For family-safe or sick-day contexts, prioritize emotional safety and clarity over prestige, darkness, or edge.",
      "9. For place/country prompts, privilege actual relevance in setting, language, perspective, or story rather than weak keyword overlap.",
      "10. For awards prompts, stay inside awards-relevant options only.",
      "11. Personalize with restraint: reinforce saved/recent preference signals, strongly avoid hidden titles, and deprioritize already-seen or very recent repeats unless the prompt clearly asks for them.",
      `12. ${preferences.request_mode === "swap" ? "For swap requests, make sure the first three backup roles cover safer_option, stretch_option, and wildcard in that order before the fourth backup." : "Give the backups distinct role keys such as safer_option, lighter_option, darker_option, wildcard, stretch_option, more_action_forward, more_demanding, or similar_tone."}`,
      "13. Avoid famous default classics unless they are still clearly the best fit after prompt fidelity.",
    ].join("\n\n"),
  };
};

const buildPickWriterPrompts = ({ preferences, intent, primary, backups }) => {
  const lastPickTitle = String(preferences.last_pick_title || "").trim();
  const lastPickReason = String(preferences.last_pick_reason || "").trim();
  const variationFocus = preferences.variation_focus;
  const variationFocusLine = variationFocus
    ? `Variation focus: ${variationFocus.description}. Emphasize how this pick shifts ${variationFocus.dimension} compared to the previous pick.`
    : "";

  return {
    systemPrompt: [
      `You are ReelBot's Recommendation Writer.`,
      getFullReelbotFrameworkText(),
      "Role rules:",
      "- Explain the chosen movie and backup roles. Do not change the ranking.",
      "- Keep it concise, specific, and decision-first.",
      "- Explain only from the provided movie information and parsed intent. Do not invent plot points, awards, countries, or credits.",
      "- Do not use banned filler or generic praise.",
      "- Never mention metadata, tags, ranking logic, candidate pools, or other internal system language.",
      "- If the fit is partial or fallback-level, say that crisply without sounding defensive.",
      "- If the parsed intent includes a time constraint fallback state, name that compromise plainly.",
      "- Treat fit_tier and derived_signals as grounding, not as user-facing jargon.",
      "- Sound like ReelBot understands the user's moment, not like an evaluation system.",
      "- Reference the previous pick when available, avoid repeating its sentence structure, and steer clear of banned phrases such as \"clear identity\" or \"doesn't feel generic.\"",
      "- Lean into the provided variation focus (tone/pacing/scale/accessibility/violence) when present and explain how this pick shifts that dimension.",
    ].join("\n\n"),
    userPrompt: [
      `Resolved preferences: ${stableStringify(preferences)}`,
      `Parsed intent: ${stableStringify(intent)}`,
      `User preference signals:\n${buildUserPreferenceBlock(preferences)}`,
      `Primary pick: ${stableStringify(primary)}`,
      `Backups: ${stableStringify(backups)}`,
      ...(lastPickTitle ? [`Previous pick title: ${lastPickTitle}`] : []),
      ...(lastPickReason ? [`Previous pick rationale: ${lastPickReason}`] : []),
      ...(variationFocusLine ? [variationFocusLine] : []),
      "Task:",
      "1. Write a prompt-specific context line that reflects the situation behind the request, not just the genre.",
      "2. Write one concise summary line about the winning movie itself.",
      "3. Write exactly 2 short reasons focused on the decision, the feel, the viewing moment, and any useful tradeoff.",
      "4. If the fit is partial, make the miss clear in plain language instead of bluffing certainty.",
      "4a. If the pick is slightly outside an explicit year or decade request, say that plainly and briefly.",
      "5. Avoid phrases like 'great match', 'metadata', 'tags', 'scoring', or anything that sounds mechanical.",
      "6. Give each backup a short role label and one-line rationale that keeps it close to the same vibe from a different angle.",
      "7. Keep the voice restrained, confident, human, and useful for a fast decision.",
      "8. Keep this pick distinct from the previous one, highlighting the new angle or contrast that makes each swap deliberate.",
      "9. Write a 10-word max 'Why this now' line that highlights the strongest change from the previous pick or the clearest differentiator.",
    ].join("\n\n"),
  };
};

module.exports = {
  buildPickRankerPrompts,
  buildPickWriterPrompts,
};
