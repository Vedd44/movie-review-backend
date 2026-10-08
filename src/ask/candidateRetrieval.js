// Feed retrieval and semantic title discovery share only the resolved request.
// Start both independent branches together; keep call budgets and errors intact.
const retrieveWithDiscovery = async ({retrieve, discover, allowDiscovery = false}) => {
 const [pool, discovered] = await Promise.all([retrieve(), allowDiscovery ? discover() : Promise.resolve([])]);
 return {pool, discovered};
};
// A semantic shortlist can itself miss an answerable request. After a failed
// selection, permit one search for untested titles, never after transport failure.
const shouldRunSemanticFallback = ({prompt = '', bounded = false, attempted = false}) => Boolean(prompt.trim()) && !bounded && !attempted;
const untestedDiscoveryCandidates = (discovered = [], considered = []) => {
 const tested = new Set(considered.map(movie => movie.id));
 return discovered.filter(movie => !tested.has(movie.id));
};
// A swap may carry a cached discovery deck. It is not an explicit collection,
// filmography or saved-list boundary; those always set bounded_pool.
const isDiscoveryBounded = request => Boolean(request.bounded_pool) || (Array.isArray(request.candidate_pool_ids) && request.candidate_pool_ids.length > 0 && !request.is_swap);
// A continuation deck loses its transient discovery flags when its real IDs
// are rehydrated from TMDB. Missing synopsis words must not become rejection
// evidence on the next turn; contradictions and final premise checks still apply.
const retainContinuationDiscovery = (movie, request, descriptive) => request.is_swap && !request.bounded_pool && descriptive
 ? {...movie,plot_discovered:true,source_type:'semantic_continuation_pool'} : movie;
const buildDiscoveryPrompt = (prompt, hard = {}, previousTitle = '', testedTitles = []) => [prompt,
 hard.max_runtime_minutes ? `No longer than ${hard.max_runtime_minutes} minutes.` : '',
 hard.min_runtime_minutes ? `At least ${hard.min_runtime_minutes} minutes.` : '',
 hard.min_release_year ? `Released from ${hard.min_release_year} onward.` : '',
 hard.max_release_year ? `Released by ${hard.max_release_year}.` : '',
 previousTitle ? `Find a different suitable film; do not suggest ${previousTitle}.` : '',
 testedTitles.length ? `The following titles were already considered without a valid selection. Search for other real films satisfying the same complete request; do not repeat these titles: ${testedTitles.join('; ')}. Return no hypotheses if none fit; do not loosen any requirement.` : '',
].filter(Boolean).join('\n');
module.exports = {retrieveWithDiscovery, shouldRunSemanticFallback, isDiscoveryBounded, buildDiscoveryPrompt, untestedDiscoveryCandidates,retainContinuationDiscovery};
