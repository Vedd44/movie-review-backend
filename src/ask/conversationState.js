const compact = (value = "") => String(value || "").replace(/\s+/g, " ").trim();
const unique = (values = []) => [...new Set(values.filter(Boolean))];

const normalizeMovie = (movie = null) => movie && typeof movie === "object" && Number(movie.id)
  ? { id: Number(movie.id), title: compact(movie.title).slice(0, 160) }
  : null;

const normalizeConversationState = (value = {}, pageContext = {}) => ({
  conversationId: compact(value.conversationId || value.conversation_id).slice(0, 80),
  pageContext: compact(pageContext.page || value.pageContext || "general").slice(0, 40),
  anchorMovie: normalizeMovie(value.anchorMovie || pageContext.movie || pageContext.currentPick),
  activeIntent: compact(value.activeIntent || (pageContext.originalPrompt ? "GENERAL_RECOMMENDATION" : "")).slice(0, 60),
  activeConstraints: value.activeConstraints && typeof value.activeConstraints === "object" ? value.activeConstraints : {},
  activeRequest: compact(value.activeRequest || pageContext.originalPrompt).slice(0, 1000),
  lastUserMessage: compact(value.lastUserMessage).slice(0, 500),
  lastAssistantResponse: compact(value.lastAssistantResponse).slice(0, 1000),
  recommendationHistory: (Array.isArray(value.recommendationHistory) ? value.recommendationHistory : []).slice(-30).map((entry) => ({
    id: Number(entry?.id) || null,
    title: compact(entry?.title).slice(0, 160),
    status: ["recommended", "rejected", "skipped"].includes(entry?.status) ? entry.status : "recommended",
  })).filter((entry) => entry.id || entry.title),
  userCorrections: (Array.isArray(value.userCorrections) ? value.userCorrections : []).map(compact).filter(Boolean).slice(-12),
});

const isCorrection = (prompt = "") => /^(?:no\b|not\b|i meant\b|actually\b|keep it\b)|\b(?:rather than|instead of)\b/i.test(compact(prompt));

const extractConstraintMutation = (prompt = "") => {
  const text = compact(prompt).toLowerCase();
  const mutation = { priority: null, add: [], hard: [], secondary: [] };
  if (/lighter|lighthearted|less (?:dark|heavy|intense|scary)/i.test(text)) {
    mutation.priority = "tone";
    mutation.add.push("lighter");
  }
  if (/turn[-\s]+(?:my|your|the)[-\s]+brain[-\s]+off|easy watch|smart but easy|not (?:dense|confusing)/i.test(text)) mutation.add.push("easy_to_follow");
  if (/\bno horror\b|\bnot horror\b/i.test(text)) mutation.hard.push("no_horror");
  if (/\bno violence\b/i.test(text)) mutation.hard.push("no_violence");
  if (/\bpg only\b/i.test(text)) mutation.hard.push("pg_only");
  if (/\bunder\s*(\d{2,3})\b|\bunder\s*(?:2|two)\s*hours?\b/i.test(text)) mutation.hard.push("runtime_cap");
  if (/not too long|short(?:er)?/i.test(text)) mutation.secondary.push("shorter");
  if (/mainstream|not obscure/i.test(text)) mutation.secondary.push("mainstream");
  if (/funny/i.test(text)) mutation.add.push("funny");
  if (/spooky/i.test(text)) mutation.add.push("spooky");
  if (/not depressing|not bleak/i.test(text)) mutation.add.push("not_depressing");
  return mutation;
};

const updateConversationForPrompt = (stateValue = {}, prompt = "", intent = "", pageContext = {}) => {
  const state = normalizeConversationState(stateValue, pageContext);
  const correction = isCorrection(prompt) || intent === "REFINE_RECOMMENDATION";
  const rejectsLast = /\b(?:not that one|skip that|not that)\b/i.test(prompt);
  const recommendationHistory = rejectsLast
    ? state.recommendationHistory.map((entry, index, list) => index === list.length - 1 ? { ...entry, status: "rejected" } : entry)
    : state.recommendationHistory;
  const mutation = extractConstraintMutation(prompt);
  const previous = state.activeConstraints || {};
  const nextConstraints = {
    ...previous,
    priority: mutation.priority || previous.priority || null,
    preferences: unique([...(previous.preferences || []), ...mutation.add]),
    hardExclusions: unique([...(previous.hardExclusions || []), ...mutation.hard]),
    secondary: unique([...(previous.secondary || []), ...mutation.secondary]),
  };
  const recommendationIntent = /RECOMMENDATION/.test(intent);
  const nextRequest = recommendationIntent && !correction && !/NEXT_RECOMMENDATION/.test(intent)
    ? compact(prompt)
    : state.activeRequest;

  return {
    ...state,
    activeIntent: intent || state.activeIntent,
    activeConstraints: nextConstraints,
    activeRequest: nextRequest,
    lastUserMessage: compact(prompt),
    recommendationHistory,
    userCorrections: correction ? [...state.userCorrections, compact(prompt)].slice(-12) : state.userCorrections,
  };
};

const buildContextualRecommendationPrompt = (prompt = "", state = {}, intent = "") => {
  const current = compact(prompt);
  const base = compact(state.activeRequest);
  if (!base || (!/REFINE_RECOMMENDATION|NEXT_RECOMMENDATION/.test(intent) && !isCorrection(current))) return current;
  const corrections = unique([...(state.userCorrections || []), ...(isCorrection(current) ? [current] : [])]);
  return [base, ...corrections.map((item) => `Correction: ${item}`)].filter(Boolean).join(". ");
};

const getConversationExcludedIds = (state = {}) => (state.recommendationHistory || [])
  .filter((entry) => ["recommended", "rejected", "skipped"].includes(entry.status))
  .map((entry) => Number(entry.id))
  .filter(Boolean);

module.exports = {
  normalizeConversationState,
  isCorrection,
  extractConstraintMutation,
  updateConversationForPrompt,
  buildContextualRecommendationPrompt,
  getConversationExcludedIds,
};
