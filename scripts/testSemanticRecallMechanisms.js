const assert = require('node:assert/strict');
const {parseReelbotIntent} = require('../ai/intentParser');
const {passesRecommendationContract} = require('../ai/recommendationContract');
for (const [prompt, genre] of [['A movie starring an actor, not a documentary',99], ['A feel-good movie for adults, no animation',16], ['A comedy without any horror',27]]) {
 const intent = parseReelbotIntent(prompt);
 assert.ok(!intent.hard_filters.required_genre_ids.includes(genre), 'A negated genre cannot become a requirement');
 assert.ok(intent.hard_filters.exclude_genre_ids.includes(genre), 'Explicit genre exclusions apply to all selections');
 assert.equal(passesRecommendationContract({genre_ids:[genre], runtime:90, release_date:'2000-01-01'},intent,{final:true}),false);
}
const mood = parseReelbotIntent('A feel-good Sunday evening movie for grown-ups, no animation');
assert.equal(mood.strict_filters.require_theme_match,false,'Suggested title hints for a mood are retrieval seeds, never factual story requirements');
assert.equal(parseReelbotIntent('A drama about a courtroom trial').strict_filters.require_theme_match,true,'Actual story themes remain requirements');
console.log('Negated genre polarity and soft retrieval-hint isolation passed.');
