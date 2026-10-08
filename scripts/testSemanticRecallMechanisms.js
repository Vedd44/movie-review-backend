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

const {parseExplicitTimeConstraint}=require('../ai/timeConstraints');
assert.deepEqual(parseExplicitTimeConstraint('An all-time classic from before 1970').range,{min_year:1900,max_year:1969});
assert.deepEqual(parseExplicitTimeConstraint('A thriller released after 1990').range,{min_year:1991,max_year:2100});
assert.deepEqual(parseExplicitTimeConstraint('A comedy from between 1985 and 1995').range,{min_year:1985,max_year:1995});
assert.equal(parseExplicitTimeConstraint('A drama set before 1970'),null,'A story era is not a release year');
for(const prompt of ['A comedy with no horror or animation','A comedy without horror and documentaries']) {
 const intent=parseReelbotIntent(prompt);
 assert.ok(intent.hard_filters.exclude_genre_ids.includes(27));
 assert.ok(intent.hard_filters.exclude_genre_ids.includes(prompt.includes('animation')?16:99));
 assert.ok(!intent.hard_filters.required_genre_ids.includes(27));
}

assert.deepEqual(parseExplicitTimeConstraint('A comedy from 1994').range,{min_year:1994,max_year:1994},'A plain release-year qualifier remains exact');
assert.equal(parseExplicitTimeConstraint('A drama set between 1985 and 1995'),null);
assert.deepEqual(parseExplicitTimeConstraint('A drama set between 1985 and 1995, released in 2000').range,{min_year:2000,max_year:2000});

assert.equal(parseReelbotIntent('A comedy under 100 minutes').hard_filters.max_runtime_minutes,99);
assert.equal(parseReelbotIntent('A comedy at most 100 minutes').hard_filters.max_runtime_minutes,100);
assert.equal(parseReelbotIntent('A drama under two hours').hard_filters.max_runtime_minutes,119);
