// Apply the same constraints to the winner, alternatives and fallback paths.
// Discovery records may lack runtime; final recommendations may not.
const GENRES = [
  [28, /\baction\b/i], [35, /\bcomedy|\bcomedies\b|\bfunny\b|\bfunnier\b|\bstupid\b/i],
  [53, /\bthriller\b/i], [9648, /\bmystery\b|\bwhodunit\b/i],
  [878, /\bsci[- ]?fi\b|\bscience fiction\b/i], [27, /\bhorror\b/i],
  [18, /\bdrama\b/i], [80, /\bcrime\b|\bheist\b/i], [16, /\banimated\b|\banimation\b/i],
  [99, /\bdocumentary\b|\bdocumentaries\b/i],
];

const explicitGenreIds = (prompt = '') => {
  const positive = String(prompt).replace(/\b(?:no|not|without|avoid|except|hate[sd]?)\s+(?:any\s+|more\s+)?(?:horror|action|comedy|drama|thriller|crime|animation|documentary)\b/gi, '');
  return GENRES.filter(([,pattern]) => pattern.test(positive)).map(([id]) => id);
};

// TMDB synopses and our estimated tone signals cannot verify scene-level absences.
const needsVerifiedContentGuide = (prompt = '') => /\b(?:no|zero|without any)\s+(?:scary|frightening|violent|sexual)\s+(?:scenes|content)\b|\b(?:zero|absolutely no)\s+(?:violence|nudity|scares)\b/i.test(prompt);

const passesRecommendationContract = (movie = {}, intent = {}, { final = false } = {}) => {
  const hard = intent.hard_filters || {};
  const runtime = Number(movie.runtime || 0);
  if ((hard.max_runtime_minutes || hard.min_runtime_minutes) && final && !runtime) return false;
  if (runtime && hard.max_runtime_minutes && runtime > hard.max_runtime_minutes) return false;
  if (runtime && hard.min_runtime_minutes && runtime < hard.min_runtime_minutes) return false;
  const year = Number(String(movie.release_date || '').slice(0, 4));
  const range = hard.time_constraint?.range;
  const minYear = hard.min_release_year || range?.min_year;
  const maxYear = hard.max_release_year || range?.max_year;
  if (minYear || maxYear) {
    if (!year || (minYear && year < minYear) || (maxYear && year > maxYear)) return false;
  }
  const genres = movie.genre_ids || movie.genres?.map(genre => genre.id) || [];
  if ((hard.exclude_genre_ids || []).some(id => genres.includes(id))) return false;
  const required = hard.required_genre_ids || [];
  if (required.length && !(hard.genre_match === 'any'
    ? required.some(id => genres.includes(id))
    : required.every(id => genres.includes(id)))) return false;
  return true;
};

const recommendationCacheScope = (request = {}, intent = {}) => JSON.stringify({
  pool: [...new Set((Array.isArray(request.candidate_pool_ids) ? request.candidate_pool_ids : []).map(Number).filter(Number.isSafeInteger))].sort((a,b) => a-b),
  bounded: Boolean(request.bounded_pool),
  intent,
  mode: request.request_mode || (request.is_swap ? 'swap' : 'initial'),
  previous: request.last_pick_title || '',
});

module.exports = { explicitGenreIds, passesRecommendationContract, recommendationCacheScope, needsVerifiedContentGuide };
