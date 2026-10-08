const normalizeRequest = value => String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
const getCommittedPrompt = (preferences = {}) => normalizeRequest(
  preferences.is_swap && typeof preferences.original_prompt === "string" ? preferences.original_prompt
  : preferences.is_swap && typeof preferences.intent_snapshot?.raw_prompt === "string" ? preferences.intent_snapshot.raw_prompt
  : preferences.prompt
);
const canReuseIntentSnapshot = (preferences = {}, resolvedPrompt = "") => Boolean(
  (preferences.is_swap || preferences.refinement)
  && typeof preferences.intent_snapshot?.raw_prompt === "string"
  && normalizeRequest(preferences.intent_snapshot.raw_prompt) === normalizeRequest(resolvedPrompt)
);
module.exports = { getCommittedPrompt, canReuseIntentSnapshot };
