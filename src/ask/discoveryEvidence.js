// Supplemental facts are hypotheses for final validation, never a bypass of
// TMDB identity, credits, hard constraints or contradictions. Keep only sources
// that the web tool actually returned, attached to the matching title and year.
const normalizeTitle = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
// Search relevance is not identity: sequels and longer titles often appear in
// the same result page. Only the hypothesized title may enter semantic discovery.
const matchesDiscoveryIdentity = (movie, query) => {
  const dated = String(query || '').match(/^(.*?)\s+\((\d{4})\)$/);
  const title = normalizeTitle(dated ? dated[1] : query);
  return Boolean(title && [movie?.title, movie?.original_title].some(value => normalizeTitle(value) === title)
    && (!dated || Math.abs(Number(String(movie.release_date || '').slice(0, 4)) - Number(dated[2])) <= 1));
};
const attachDiscoveryEvidence = (movie, evidence = [], retrievedSources = []) => {
  const sources = new Set(retrievedSources);
  const year = Number(String(movie.release_date || '').slice(0,4));
  const titles = [movie.title,movie.original_title].map(normalizeTitle);
  const matched = evidence.filter(entry => {
    const query = String(entry.query || '').match(/^(.*?)\s+\((\d{4})\)$/);
    return query && titles.includes(normalizeTitle(query[1])) && Math.abs(year-Number(query[2])) <= 1;
  }).map(entry => ({facts:String(entry.facts || '').slice(0,600),source_urls:(entry.source_urls || []).filter(url => sources.has(url) && /^https?:\/\//.test(url)).slice(0,2)}))
    .filter(entry => entry.facts.trim() && entry.source_urls.length).slice(0,2);
  return matched.length ? {...movie,discovery_evidence:matched} : movie;
};
const discoveryQueries = parsed => {
  const films = Array.isArray(parsed?.films) ? parsed.films.slice(0,4) : [];
  const queryFor = film => String(film.title || '').trim() + (Number.isInteger(film.release_year) ? ` (${film.release_year})` : '');
  const queries = [...new Set(films.map(queryFor).filter(Boolean))];
  queries.film_evidence = films.map(film => ({query:queryFor(film),facts:film.facts,source_urls:film.source_urls}));
  queries.retrieved_source_urls = parsed?.retrieved_source_urls || [];
  return queries;
};
module.exports = {attachDiscoveryEvidence,discoveryQueries,matchesDiscoveryIdentity};
