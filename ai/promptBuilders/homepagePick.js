const { getPrinciplesText } = require("../reelbotPrinciples");
const { getVoiceText } = require("../reelbotVoice");
const { RUBRICS } = require("../recommendationRubrics");

const stableStringify = (value) => {
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

const buildPickRankerPrompts = ({ preferences, intent, candidates }) => {
  const candidateBlock = candidates.map((movie) => stableStringify(movie)).join("\n");

  return {
    systemPrompt: [
      `You are ReelBot's Candidate Ranker.`,
      getPrinciplesText(),
      getVoiceText(),
      "Role rules:",
      "- Do not write user-facing copy.",
      "- Rank only from the provided candidate ids.",
      "- Never infer or reference movies outside the provided candidate pool.",
      "- Honor the parsed intent lane more than generic popularity.",
      "- Backup choices must stay in the same high-level lane while varying role.",
    ].join("\n\n"),
    userPrompt: [
      `Resolved preferences: ${stableStringify(preferences)}`,
      `Parsed intent: ${stableStringify(intent)}`,
      `Matched rubrics:\n${buildRubricBlock(intent)}`,
      `Candidate pool:\n${candidateBlock}`,
      "Task:",
      "1. Choose exactly 1 top pick and 4 backup picks.",
      "2. Preserve the original lane for anchor prompts, title-similarity prompts, and swap requests.",
      "3. Reward audience fit, context fit, tone fit, pacing fit, emotional fit, accessibility fit, prompt fidelity, and non-obviousness.",
      "4. Avoid famous default classics unless they are still clearly the best fit after prompt fidelity.",
      "5. Treat child/family comfort contexts as safety-critical: do not elevate anything scary, distressing, violent, or adult-coded.",
      "6. Give the backups distinct role keys such as safer_option, lighter_option, darker_option, wildcard, more_action_forward, more_demanding, or similar_tone.",
    ].join("\n\n"),
  };
};

const buildPickWriterPrompts = ({ preferences, intent, primary, backups }) => ({
  systemPrompt: [
    `You are ReelBot's Recommendation Writer.`,
    getPrinciplesText(),
    getVoiceText(),
    "Role rules:",
    "- Explain the chosen movie and backup roles. Do not change the ranking.",
    "- Keep it concise, specific, and decision-first.",
    "- Explain only from the provided movie information and parsed intent. Do not invent plot points, awards, countries, or credits.",
    "- Do not use banned filler or generic praise.",
    "- Never mention metadata, tags, ranking logic, candidate pools, or other internal system language.",
  ].join("\n\n"),
  userPrompt: [
    `Resolved preferences: ${stableStringify(preferences)}`,
    `Parsed intent: ${stableStringify(intent)}`,
    `Primary pick: ${stableStringify(primary)}`,
    `Backups: ${stableStringify(backups)}`,
    "Task:",
    "1. Write a prompt-specific context line in plain, human language.",
    "2. Write one concise summary line about the winning movie itself.",
    "3. Write exactly 2 short reasons focused on what the movie feels like and why it fits.",
    "4. Give each backup a short role label and one-line rationale that keeps it close to the same vibe from a different angle.",
    "5. Keep the voice restrained, intelligent, and useful for a fast decision.",
  ].join("\n\n"),
});

module.exports = {
  buildPickRankerPrompts,
  buildPickWriterPrompts,
};
