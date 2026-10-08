// Apply the same constraints to the winner, alternatives and fallback paths.
// Discovery records may lack runtime; final recommendations may not.
const GENRES = [
  [28, /\baction\b/i], [35, /\bcomedy|\bcomedies\b|\bfunny\b|\bfunnier\b|\bstupid\b/i],
  [53, /\bthriller\b/i], [9648, /\bmystery\b|\bwhodunit\b/i],
  [878, /\bsci[- ]?fi\b|\bscience fiction\b/i], [27, /\bhorror\b/i],
  [18, /\bdrama\b/i], [80, /\bcrime\b|\bheist\b/i], [16, /\banimated\b|\banimation\b/i],
  [99, /\bdocumentary\b|\bdocumentaries\b/i],
];

// Read polarity at each genre mention, including articles ("not a documentary").
// The existing genre vocabulary stays shared by requirements and exclusions.
const genreMentions = (prompt = '') => GENRES.flatMap(([id, pattern]) => {
 const text = String(prompt); const matches = [...text.matchAll(new RegExp(pattern.source, 'gi'))];
 return matches.map(match => {
  const prefix = text.slice(Math.max(0,match.index-100),match.index);
  // Negation extends through a coordinated list of genres, but stops at a new
  // clause or an unrelated word. Use the shared genre grammar, not examples.
  const genreSource = GENRES.map(([,expression]) => `(?:${expression.source})`).join('|');
  const excluded = new RegExp(`\\b(?:no|not|without|avoid|except|hate[sd]?)\\s+(?:(?:a|an|any|more)\\s+)?(?:(?:${genreSource})\\s*(?:,\\s*|(?:and|or)\\s+))*$`, 'i').test(prefix);
  return {id, excluded};
 });
});
const explicitGenreIds = prompt => [...new Set(genreMentions(prompt).filter(m => !m.excluded).map(m => m.id))];
const explicitExcludedGenreIds = prompt => [...new Set(genreMentions(prompt).filter(m => m.excluded).map(m => m.id))];

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
  // An adult audience is a request constraint, not a maturity rating. Animation
  // remains eligible; only generic child/family picks are excluded unless asked for.
  const adultAudience = intent.audience_age === 'adults';
  const familyRequested = explicitGenreIds(intent.raw_prompt || '').includes(16)
    || /\b(?:family|kids|children)\b/i.test(String(intent.raw_prompt || '').replace(/\b(?:no|not|without|avoid)\s+(?:family|kids|children)\b/gi,''))
    || Boolean(intent.anchors?.title);
  if (adultAudience && !familyRequested && genres.includes(10751)) return false;
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

module.exports = { explicitGenreIds, explicitExcludedGenreIds, passesRecommendationContract, recommendationCacheScope, needsVerifiedContentGuide };
