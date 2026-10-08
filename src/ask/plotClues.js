// Finite, conservative spelling fixes for clue words. Never fuzzy-match names,
// movie titles, numbers or arbitrary vocabulary, and keep the original prompt.
const SPELLING = Object.freeze({movue:'movie',mvoie:'movie',moive:'movie',flim:'film',wher:'where',remeber:'remember',rememeber:'remember',reccomend:'recommend',recomend:'recommend',restaraunt:'restaurant',resturant:'restaurant',restraunt:'restaurant',restuarant:'restaurant',workign:'working',peopel:'people',nigth:'night',strnage:'strange',happnes:'happens',hapen:'happen',happning:'happening'});
const normalizeCluePrompt = value => String(value || '').replace(/\b[a-z]+\b/gi, word => SPELLING[word.toLowerCase()] || word).replace(/\s+/g,' ').trim();
function hasDescriptivePlotRequest(prompt='') {
 const text=normalizeCluePrompt(prompt);
 return /\b(?:movie|film|thriller|horror|drama|comedy|something|story)s?\s+(?:(?:that|which)\s+)?(?:where|in which|takes place|set (?:in|on|at)|(?:in|on|at)\s+(?:a |an |the )?(?:restaurant|diner|hospital|prison|train|plane|spaceship|submarine)|about\s+(?:(?:a|an|the)\s+)?(?:[a-z-]+\s+){0,3}(?:man|woman|person|people|group|crew|family|couple|detective|cop|soldier|child|boy|girl|workers?|employees?|staff|waitress|chef)\b|with\s+(?:(?:a|an|the)\s+)?(?:man|woman|person|group|crew|family|couple)\b)/i.test(text)
  || extractPlotConstraints(text).length>0
  || /\b(?:hero|protagonist|main character)\b[^.!?]*\b(?:dies|death|killed)\b|\b(?:tragic|sad) ending\b/i.test(text);
}
const SCENE_VENUES = [
 ['food workplace', /\b(?:at|in|inside|working (?:at|in))\s+(?:a |an |the )?(?:restaurant|diner|cafe|caf[eé]|pizzeria|pizza (?:place|parlor)|fast[- ]food (?:place|restaurant|joint)|food (?:place|joint))\b/i, /\b(?:restaurant|diner|caf[eé]|pizzeria|pizza (?:place|parlor)|fast[- ]food|burger (?:joint|restaurant))\b/i],
 ['hospital', /\b(?:at|in|inside)\s+(?:a |an |the )?hospital\b/i, /\bhospital|medical (?:center|centre)|hospital ward\b/i],
 ['prison', /\b(?:at|in|inside)\s+(?:a |an |the )?(?:prison|jail)\b/i, /\bprison|jail|penitentiary|inmate\b/i],
 ['train', /\b(?:on|aboard|inside)\s+(?:a |an |the )?train\b/i, /\btrain|railway|railroad|locomotive\b/i],
 ['airplane', /\b(?:on|aboard|inside)\s+(?:a |an |the )?(?:plane|airplane|aircraft)\b/i, /\bplane|airplane|aircraft|flight|airliner\b/i],
 ['spacecraft', /\b(?:on|aboard|inside)\s+(?:a |an |the )?(?:spaceship|spacecraft|space station)\b/i, /\bspaceship|spacecraft|space station|starship|astronaut|space voyage\b/i],
];
// Reserve metadata space for clue-discovered films before popularity-ranked feeds.
// The bound keeps the existing metadata work budget predictable.
function selectMetadataCandidates(preliminary=[],semantic=[],discovered=[]) {
 const seen=new Set();
 return [...discovered,...preliminary.slice(0,36),...semantic.slice(0,12)].filter(movie=>{
  if(!movie?.id || seen.has(movie.id)) return false;
  seen.add(movie.id);return true;
 }).slice(0,48);
}
function extractPlotConstraints(prompt='') {
 const text=normalizeCluePrompt(prompt);
 // A venue requested as part of a story, not a viewing occasion or a negation.
 if (/\b(?:movie|film|watch|watching|recommend|pick)\b[^.!?]*\b(?:after (?:my |a )?(?:night shift|working)|while (?:i|we)(?:[’\']re| are)? working)\b/i.test(text) && !/\b(?:where|in which|set|takes place|story|about)\b/i.test(text)) return [];
 const scene=/\b(?:where|in which|story|set|takes place|about|working|works|worker|shift|trapped)\b/i.test(text);
 if (!scene) return [];
 const constraints=SCENE_VENUES.filter(([,request])=>request.test(text)).filter(([,request])=>{
  const match=text.match(request);const before=text.slice(Math.max(0,match.index-35),match.index);
  return !/\b(?:not|never|except|avoid|without)\b[^,.!?]*$/i.test(before);
 }).map(([label,,evidence])=>({label,evidence}));
 if (constraints.length && /\b(?:working|works|workers?|employees?|staff|shift)\b/i.test(text) && !/\bafter (?:a |the |their |his |her )?(?:night |late[- ]night )?shift\b/i.test(text)) {
  constraints.push({label:'people working',evidence:/\b(?:work(?:s|ing|er|ers)?|employee|staff|shift|waiter|waitress|waitstaff|cook|chef|server|cashier|janitor|cleaner|nurse|doctor|guard|pilot|crew)\b/i});
  if (/\b(?:late[- ]night|night shift|overnight|after (?:hours|dark)|at night)\b/i.test(text)) constraints.push({label:'night work',evidence:/\b(?:night|overnight|after (?:hours|dark)|graveyard shift|closing time)\b/i});
 }
 return constraints;
}
function passesPlotConstraints(movie={},constraints=[]) {
 const evidence=[movie.overview,movie.tagline,...(Array.isArray(movie.keyword_names)?movie.keyword_names:[])].filter(Boolean).join(' ');
 return constraints.every(clue=>clue.evidence.test(evidence));
}
// Missing words in a short synopsis are not proof that a remembered scene is absent.
// Reject explicit competing settings here; the semantic ranker checks all other clues.
function contradictsPlotConstraints(movie={},constraints=[]) {
 const text=[movie.overview,movie.tagline,...(Array.isArray(movie.keyword_names)?movie.keyword_names:[])].filter(Boolean).join(' ');
 const food=constraints.find(clue=>clue.label==='food workplace');
 if(food && !food.evidence.test(text) && /\b(?:furniture showroom|biotech facility|police (?:station|officers)|cartel|tablet|hospital|prison|spaceship)\b/i.test(text)) return true;
 return false;
}
// Semantic title discovery may rely on an established scene absent from a teaser.
// The ranker still must validate the complete premise; explicit contradictions reject it.
function passesPlotCandidateEvidence(movie={},constraints=[]) {
 return movie.plot_discovered === true
  ? !contradictsPlotConstraints(movie,constraints)
  : passesPlotConstraints(movie,constraints);
}
function getPlotClarification(prompt='') {
 return hasDescriptivePlotRequest(prompt) && /\bafter (?:a |the |their |his |her )?(?:night |late[- ]night )?shift\b/i.test(prompt)
  ? "Do you mean a film about people working that shift, or what happens after they finish work?"
  : null;
}
function protectEndingSpoilers(reason='',prompt='') {
 const text=String(reason || '').trim();
 const endingCategory=/\b(?:hero|protagonist|main character)\b[^.!?]*\b(?:dies|death|killed)\b|\b(?:tragic ending|sad ending|ending where)\b/i.test(prompt);
 const requestedDetails=/\b(?:who dies|how .{0,40}dies|how .{0,40}killed|explain (?:the )?ending|spoilers? (?:please|allowed|are fine)|tell me (?:the )?(?:ending|who))\b/i.test(prompt);
 if(!endingCategory || requestedDetails) return text;
 const sentences=(text.replace(/\b(?:Mr|Mrs|Ms|Dr|Jr|Sr)\./g,word=>word.replace('.','∯')).match(/[^.!?]+(?:[.!?]+|$)/g) || []).map(sentence=>sentence.replace(/∯/g,'.'));
 const safe=sentences.filter(sentence=>!/\b(?:die(?:s|d|ing)?|deaths?|dead|killed|fatal|tragic end|executed|sacrific(?:e|es|ed)|plays|portrays|fate|suicide|doesn[’\']t survive|does not survive)\b/i.test(sentence));
 return safe.length===sentences.length ? text : ['This has the kind of ending you’re looking for. I’ll leave the details for you to discover.',...safe.map(sentence=>sentence.trim())].join(' ');
}
const isExplicitModelAbstention = ranking => Boolean(ranking && Object.prototype.hasOwnProperty.call(ranking,'primary') && ranking.primary === null);
module.exports={passesPlotCandidateEvidence,getPlotClarification,selectMetadataCandidates,normalizeCluePrompt,hasDescriptivePlotRequest,extractPlotConstraints,passesPlotConstraints,contradictsPlotConstraints,protectEndingSpoilers,isExplicitModelAbstention};
