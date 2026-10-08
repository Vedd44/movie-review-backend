// Feed retrieval and semantic title discovery share only the resolved request.
// Start both independent branches together; keep call budgets and errors intact.
const retrieveWithDiscovery = async ({retrieve, discover, allowDiscovery = false}) => {
 const [pool, discovered] = await Promise.all([retrieve(), allowDiscovery ? discover() : Promise.resolve([])]);
 return {pool, discovered};
};
const shouldRunSemanticFallback = ({prompt = '', bounded = false, attempted = false, discoveryPerformed = false}) => Boolean(prompt.trim()) && !bounded && !attempted && !discoveryPerformed;
// A swap may carry a cached discovery deck. It is not an explicit collection,
// filmography or saved-list boundary; those always set bounded_pool.
const isDiscoveryBounded = request => Boolean(request.bounded_pool) || (Array.isArray(request.candidate_pool_ids) && request.candidate_pool_ids.length > 0 && !request.is_swap);
const buildDiscoveryPrompt = (prompt, hard = {}, previousTitle = '') => [prompt,
 hard.max_runtime_minutes ? `No longer than ${hard.max_runtime_minutes} minutes.` : '',
 hard.min_runtime_minutes ? `At least ${hard.min_runtime_minutes} minutes.` : '',
 hard.min_release_year ? `Released from ${hard.min_release_year} onward.` : '',
 hard.max_release_year ? `Released by ${hard.max_release_year}.` : '',
 previousTitle ? `Find a different suitable film; do not suggest ${previousTitle}.` : '',
].filter(Boolean).join('\n');
module.exports = {retrieveWithDiscovery, shouldRunSemanticFallback, isDiscoveryBounded, buildDiscoveryPrompt};
