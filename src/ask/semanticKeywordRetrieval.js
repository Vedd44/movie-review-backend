// A failed title shortlist is a recall limit, not a catalogue limit. Reuse the
// discovery model's bounded semantic terms to find real TMDB records. These
// terms are retrieval seeds only; the connected-premise validator still decides.
const fetchSemanticKeywordCandidates = async (terms = [], hard = {}, {resolveKeywordIds, fetchTmdb, today = new Date().toISOString().slice(0,10)} = {}) => {
 const seeds = [...new Set(terms.map(term => String(term || '').trim()).filter(term => term && term.length <= 48))].slice(0,3);
 if (!seeds.length) return [];
 let keywords = (await resolveKeywordIds(seeds)).filter(entry => entry.score >= 120).slice(0,3);
 // Model seeds sometimes describe a relationship in a phrase that TMDB's
 // keyword catalogue cannot resolve. Try one constituent term per phrase,
 // bounded to three additional searches, only when no exact seed resolved.
 // This expands recall; it never establishes that the film meets the premise.
 if(!keywords.length) {
  const atomic=[...new Set(seeds.map(seed=>seed.match(/[\p{L}\p{N}]+/gu) || []).filter(words=>words.length>1).map(words=>words.filter(word=>word.length>=4).sort((a,b)=>b.length-a.length)[0]).filter(Boolean))].slice(0,3);
  if(atomic.length) keywords=(await resolveKeywordIds(atomic)).filter(entry=>entry.score>=120).slice(0,3);
 }
 if (!keywords.length) return [];
 const ids = keywords.map(entry => entry.id);
 const params = {include_adult:'false',page:1,'primary_release_date.lte':hard.max_release_year ? [today,`${hard.max_release_year}-12-31`].sort()[0] : today};
 if(hard.min_release_year) params['primary_release_date.gte']=`${hard.min_release_year}-01-01`;
 if(hard.max_runtime_minutes) params['with_runtime.lte']=hard.max_runtime_minutes;
 if(hard.min_runtime_minutes) params['with_runtime.gte']=hard.min_runtime_minutes;
 if(hard.required_genre_ids?.length) params.with_genres=hard.required_genre_ids.join(hard.genre_match==='any'?'|':',');
 if(hard.exclude_genre_ids?.length) params.without_genres=hard.exclude_genre_ids.join(',');
 // Combined semantic seeds retain priority over the broader catalogue pool.
 const plans=[{with_keywords:ids.join(','),sort_by:'popularity.desc'}, {with_keywords:ids.join('|'),sort_by:'vote_count.desc'}];
 const responses=await Promise.allSettled(plans.map(plan=>fetchTmdb('/discover/movie',{...params,...plan})));
 if(responses.every(response=>response.status==='rejected')) throw responses[0].reason;
 const seen=new Set();
 return responses.filter(response=>response.status==='fulfilled').flatMap(response=>response.value?.results || []).filter(movie=>{
  if(!movie.id || seen.has(movie.id) || movie.adult || !movie.overview || !movie.poster_path) return false;
  seen.add(movie.id);return true;
 }).slice(0,18);
};
module.exports={fetchSemanticKeywordCandidates};
