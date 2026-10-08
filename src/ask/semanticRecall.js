const {normalizeCluePrompt,hasDescriptivePlotRequest}=require('./plotClues');
const {isDiscoveryBounded}=require('./candidateRetrieval');
// Reuse verified movie identities, never a past answer or a taste inference.
// Exact effective request keys prevent old refinements leaking into new topics.
const semanticRecallKey=(request,preferences,intent)=>!isDiscoveryBounded(request) && hasDescriptivePlotRequest(preferences.prompt)
 ? JSON.stringify({prompt:normalizeCluePrompt(preferences.prompt).toLowerCase(),intent,genre:preferences.genre,mood:preferences.mood,runtime:preferences.runtime,view:preferences.view,company:preferences.company,theatrical:preferences.include_theatrical}) : null;
const retainVerifiedIdentities=(previous=[],selected=[])=>[...new Set([...selected,...previous].map(value=>Number(value?.id || value)).filter(id=>Number.isInteger(id)&&id>0))].slice(0,12);
module.exports={semanticRecallKey,retainVerifiedIdentities};
