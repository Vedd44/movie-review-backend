const WATCH_COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;

// Only deliberate rewatch language overrides history, not mentions of a movie
// the user loved or broad requests for a comforting / rewatchable film.
const isExplicitRewatchRequest = (prompt = "") => {
  const text = String(prompt).toLowerCase().replace(/[’]/g, "'");
  if (/\b(?:don't|do not|no|not|avoid|without)\s+(?:want\s+)?(?:to\s+)?(?:re[ -]?watch(?:es|ing)?|watch(?:ing)?\s+\w+\s+again)\b/.test(text)
      || /\b(?:haven't|have not|never|not)\s+(?:seen|watched)\b|\bunseen\b/.test(text)) return false;
  return /\bre[ -]?watch(?:ing)?\b|\bwatch(?:ing)?\s+[^.!?]{0,80}\bagain\b|\brevisit(?:ing)?\s+(?:a|an|the|my|some|that|this)\b|\b(?:something|movies?|films?)\s+(?:i(?:'ve| have)?\s+)?(?:already\s+)?(?:seen|watched)\s+before\b/.test(text);
};

const isExplicitUnseenRequest = (prompt = "") => /\b(?:haven['’]?t|have not|never|not)\s+(?:seen|watched)\b|\bunseen\b/i.test(String(prompt));

const normalizeWatchedAt = (dates = {}) => Object.fromEntries(
  Object.entries(dates && typeof dates === "object" ? dates : {})
    .filter(([id, date]) => Number.isInteger(Number(id)) && Number(id) > 0 && typeof date === "string" && Number.isFinite(Date.parse(date)))
    .map(([id, date]) => [Number(id), new Date(date).toISOString()])
);

const getWatchCooldownIds = (dates = {}, now = Date.now()) => Object.entries(normalizeWatchedAt(dates))
  .filter(([, date]) => { const age = now - Date.parse(date); return age >= 0 && age < WATCH_COOLDOWN_MS; })
  .map(([id]) => Number(id));

const getWatchedMovieAdjustment = (movieId, memory = {}, prompt = "", now = Date.now()) => {
  const seenIds = memory.seenMovieIds instanceof Set ? memory.seenMovieIds : new Set((memory.seenMovieIds || []).map(Number));
  if (!seenIds.has(Number(movieId))) return { excluded: false, score: 0 };
  if (isExplicitUnseenRequest(prompt)) return { excluded: true, score: -1000 };
  if (isExplicitRewatchRequest(prompt)) return { excluded: false, score: 0 };
  return { excluded: getWatchCooldownIds(memory.watchedAt, now).includes(Number(movieId)), score: -4 };
};

module.exports = { WATCH_COOLDOWN_MS, isExplicitRewatchRequest, isExplicitUnseenRequest, normalizeWatchedAt, getWatchCooldownIds, getWatchedMovieAdjustment };
