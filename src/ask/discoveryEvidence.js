// Supplemental facts are hypotheses for final validation, never a bypass of
// TMDB identity, credits, hard constraints or contradictions. Keep only sources
// that the web tool actually returned, attached to the matching title and year.
const normalizeTitle = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
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
module.exports = {attachDiscoveryEvidence};
