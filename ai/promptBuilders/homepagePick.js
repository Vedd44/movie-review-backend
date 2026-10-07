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
  const memory = preferences.behavioral_memory || {};
  return [
    "The current request comes first. Historical activity is not a taste identity.",
    "Clicks, provider visits and Seen mean exploration/history, not enjoyment. Saved means interest, not liked.",
    "Repeated saves may gently break ties between equally suitable candidates, never override the request.",
    "Do not describe usual tastes, a departure from their taste, or claim they like a genre/tone based on activity.",
    `Hidden titles must remain excluded: ${stableStringify(memory.hiddenMovieIds || [])}`,
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
      "- The current request outranks historical interest; exploring a movie never declares a lasting taste.",
      "- Rank only from the provided candidate ids.",
      "- Never infer or reference movies outside the provided candidate pool.",
      "- Treat audience, tone, safety, and explicit exclusions as hard filters before ranking.",
      "- Treat explicit release-year and release-decade constraints as hard filters unless the parsed intent already marks a fallback state.",
      "- Honor the parsed intent lane more than generic popularity.",
      "- Treat the user's moment as the real target, not just broad genre similarity.",
      "- Distinguish the safest strong fit from the most interesting strong fit when they are not the same movie.",
      "- Derived signals are estimates, not verified content guidance. Animation or family genre never proves a movie is gentle or suitable for a particular age.",
      "- Backup choices must stay in the same high-level lane while offering genuinely different decision routes.",
      "- For person_context, choose a film that showcases that person's credited work. A starting point should feature a substantial role; avoid cameos, self appearances, and uncredited parts. Use person_credit and cast order (lower is more prominent).",
      "- Avoid multiple films from the same franchise or near-identical tone/runtime/era unless the request explicitly calls for them.",
    ].join("\n\n"),
    userPrompt: [
      `Resolved preferences: ${stableStringify(preferences)}`,
      `Parsed intent: ${stableStringify(intent)}`,
      `User preference signals:\n${buildUserPreferenceBlock(preferences)}`,
      `Matched rubrics:\n${buildRubricBlock(intent)}`,
      `Candidate pool:\n${candidateBlock}`,
      "Task:",
      "1. Choose 1 top pick and up to 3 backup picks. Return fewer when the remaining candidates do not meet the request.",
      "2. Preserve the original lane for anchor prompts, title-similarity prompts, and swap requests.",
      "3. Reject candidates that miss explicit year/decade, audience, tone, safety, or exclusion constraints before you rank anything else.",
      "4. Reward audience fit, context fit, tone fit, pacing fit, emotional fit, accessibility fit, prompt fidelity, and non-obviousness.",
      "5. Prefer clear fit tradeoffs over prestige language or famous defaults.",
      "6. Soft preferences may allow an adjacent fit, but a core plot clue may not: a film that fails the essential premise is not a recommendation. Do not explain away a core mismatch in public copy.",
      "6a. Scores and fit labels never override a core plot contradiction. Choose a supplied candidate only when the actual evidence supports the core request; otherwise abstain.",
      "7. When the prompt contains situational context such as kids, parents, low-stress, background watch, immersive, awards, or country/location intent, let that context outrank vague semantic similarity.",
      "8. For family-safe or sick-day contexts, prioritize emotional safety and clarity over prestige, darkness, or edge.",
      "9. For place/country prompts, privilege actual relevance in setting, language, perspective, or story rather than weak keyword overlap.",
      "10. For awards prompts, stay inside awards-relevant options only.",
      "11. The current request outranks historical interest. Never infer enjoyment from saved, viewed or seen titles. Honor hidden exclusions and already-seen repeat handling.",
      `12. Give the backups distinct, evidence-based roles such as lighter_option, darker_option, shorter_option, more_mainstream, more_emotional, more_intense, more_recent, more_classic, wildcard, more_action_forward, more_demanding, or similar_tone. For swaps, preserve the request but do not mechanically force safer/stretch/wildcard roles.`,
      "13. Avoid famous default classics unless they are still clearly the best fit after prompt fidelity.",
      "14. Prefer fewer meaningful distinctions over cosmetic role changes: use runtime, tone, intensity, accessibility, era, emotional weight, or mainstream familiarity only when candidate data supports it.",
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
      "- Treat derived_signals as fallible estimates. Never promise no scary scenes, no violence, or guaranteed age suitability without verified content guidance. Runtime does not establish pacing.",
      "- Sound like ReelBot understands the user's moment, not like an evaluation system.",
      "- The primary rationale should read like a knowledgeable friend: one sentence on the specific fit, then one useful tradeoff or distinction.",
      "- Do not infer or narrate usual taste from clicks, saves or Seen. Explain the movie against the current request, without historical taste labels.",
      "- Never merely restate the request. Name concrete tone, pacing, story setup, intensity, runtime, or audience differences supported by the provided fields.",
      "- Avoid 'strong fit', 'great pick', 'matches the mood', 'based on your preferences', 'same feel', and other copy that could describe almost any movie.",
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
      "2. Write one concise summary line naming the winning movie's most relevant concrete quality.",
      "3. Write exactly 2 short reasons: first explain the specific fit; second give a useful tradeoff, caveat, or distinction. Do not repeat the same claim twice.",
      "4. If the fit is partial, make the miss clear in plain language instead of bluffing certainty.",
      "4a. If the pick is slightly outside an explicit year or decade request, say that plainly and briefly.",
      "5. Avoid phrases like 'great match', 'metadata', 'tags', 'scoring', or anything that sounds mechanical.",
      "6. Return only the supplied backup ids (including an empty list when none are supplied). Give each backup a short editorial role label and one-line rationale naming its real difference from the primary. Every backup must offer a different reason to choose it.",
      "7. Keep the voice restrained, confident, human, and useful for a fast decision.",
      "8. Keep this pick distinct from the previous one, highlighting the new angle or contrast that makes each swap deliberate.",
      "9. Write a 10-word max 'Why this now' line that highlights the strongest change from the previous pick or the clearest differentiator.",
      "10. Keep the combined primary rationale spoiler-light and under 55 words.",
    ].join("\n\n"),
  };
};

module.exports = {
  buildPickRankerPrompts,
  buildPickWriterPrompts,
  buildPickDecisionPrompts: (args) => {
    const prompts = buildPickRankerPrompts(args);
    return {
      systemPrompt: prompts.systemPrompt.replace("- Do not write user-facing copy.", [
        "- Explain each selected movie in its reason field. Selection and explanation are one decision.",
        "- If no candidate satisfies the core request, return primary:null and backups:[]; never force the least-wrong winner. An explanation admitting that the setting, subject or central action is absent is a reason to reject it, not justify it. Minor tone tradeoffs are acceptable; core plot contradictions are not. Preserve every distinctive context clue together. Interpret ordinary spelling mistakes conservatively, and do not rewrite names or movie titles.",
        "- Primary reason: 30–45 words explaining the specific fit. Add a tradeoff only when useful; never mechanically append a miss or negative comparison. Backup reasons: 15–25 words naming a supported difference while still fulfilling the core request. Never write audit phrases such as the key miss, substantial compromise, not the requested setting, or rather than anything requested: reject those candidates instead.",
        "- Ground every claim in the supplied overview, credits, genre, runtime and evidence. Do not invent scenes, awards or content-guide details.",
        "- Derived signals are estimates: qualify tone or intensity inferences. Runtime is not evidence of pacing. Never promise no scary scenes or guaranteed age suitability.",
        "- No generic praise, internal scoring language, metadata references, or repetition of the request. Write like a thoughtful film guide. Never write plausible match, key miss, the overview cannot confirm or detail remains unverified.",
        "- Stay spoiler-light even when the request names an ending category such as a hero dying. Confirm that the movie fits that category without identifying who dies, how, a twist or further ending details unless the user specifically asks for those details.",
        "- Preserve the request and previous-pick context when explaining a swap. Do not repeat the previous reason's phrasing.",
      ].join("\n")),
      userPrompt: prompts.userPrompt,
    };
  },
};
