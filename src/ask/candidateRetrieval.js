// Feed retrieval and semantic title discovery share only the resolved request.
// Start both independent branches together; keep call budgets and errors intact.
const retrieveWithDiscovery = async ({retrieve, discover, allowDiscovery = false}) => {
 const [pool, discovered] = await Promise.all([retrieve(), allowDiscovery ? discover() : Promise.resolve([])]);
 return {pool, discovered};
};
const shouldRunSemanticFallback = ({prompt = '', bounded = false, attempted = false, discoveryPerformed = false}) => Boolean(prompt.trim()) && !bounded && !attempted && !discoveryPerformed;
module.exports = {retrieveWithDiscovery, shouldRunSemanticFallback};
