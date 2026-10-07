const assert=require('node:assert/strict');
const {normalizeCluePrompt,extractPlotConstraints,passesPlotConstraints,protectEndingSpoilers,isExplicitModelAbstention}=require('../src/ask/plotClues');
const {classifyAskIntent,ASK_INTENTS}=require('../src/ask/askIntent');
let checks=0;
const scene='Movie where a person or group of people are working late night at a food place and strange things happen';
const variants=[scene,scene.replace(' and strange things happen',''),scene.replace('Movie where','Moive wher').replace('people','peopel').replace('working','workign').replace('night','nigth').replace('strange','strnage'), 'Film in which workers are working overnight in a restaurant', 'A movie where a waitress works the night shift in a diner'];
const wrong=[{overview:'An inexplicable doorway opens in a furniture showroom.'},{overview:'Toys contend with a tablet.'},{overview:'Staff working overnight in a biotech facility encounter a virus.'},{overview:'Police work their last night shift confronting a cartel.'},{overview:'A chef runs a restaurant during the daytime.'},{overview:'Patrons eat dinner in a restaurant.'}];
for(const prompt of variants){
 assert.equal(classifyAskIntent({prompt}),ASK_INTENTS.MOVIE_IDENTIFICATION,prompt);checks++;
 const constraints=extractPlotConstraints(prompt);assert.ok(constraints.some(c=>c.label==='food workplace'));checks++;
 for(const movie of wrong){assert.equal(passesPlotConstraints(movie,constraints),false,`${prompt}: ${movie.overview}`);checks++;}
 assert.equal(passesPlotConstraints({overview:'A waitress working the overnight shift at a rural diner faces strange events.'},constraints),true);checks++;
}
for(const prompt of ['Recommend a movie where workers are working late night at a food place','Movies where people work in a diner','Something funny','A movie to watch after my night shift','Where can I watch Interstellar?']){
 assert.notEqual(classifyAskIntent({prompt}),ASK_INTENTS.MOVIE_IDENTIFICATION,prompt);checks++;
}
for(const prompt of ['Something to watch at a restaurant','A movie after working at a restaurant','Not a movie set in a restaurant','A comedy to watch on a train']){
 // The after-work occasion is explicitly excluded below; it is not story evidence.
 assert.equal(extractPlotConstraints(prompt).length,0,prompt);checks++;
}
for(const [prompt,good,bad] of [['A movie where a nurse works at night in a hospital','A nurse works at night in a hospital.','A chef works at night in a diner.'],['A movie where people are trapped on a train','Passengers trapped on a train.','People trapped on a plane.'],['A movie set in a prison','Inmates in a prison.','Students in a school.'],['A movie where a pilot is working overnight on an airplane','A pilot works an overnight flight aboard an airplane.','A pilot flies a daytime flight.'],['A movie where a crew is trapped on a spaceship','A crew trapped on a spacecraft.','A crew trapped in a submarine.']]){
 const c=extractPlotConstraints(prompt);assert.equal(passesPlotConstraints({overview:good},c),true);assert.equal(passesPlotConstraints({overview:bad},c),false);checks+=2;
}
for(const title of ['Interstellar','Ronin','Heat','Memento','The Menu','Willy’s Wonderland','Last Straw','Poultrygeist: Night of the Chicken Dead']){assert.equal(normalizeCluePrompt(title),title);checks++;}
assert.equal(isExplicitModelAbstention({primary:null,backups:[]}),true);assert.equal(isExplicitModelAbstention(null),false);assert.equal(isExplicitModelAbstention({primary:{id:1}}),false);checks+=3;
const {pickDecisionSchema}=require('../ai/aiSchemas');assert.ok(pickDecisionSchema.properties.primary.type.includes('null'));checks++;
assert.equal(protectEndingSpoilers('Tony Stark dies in the finale. An epic superhero conclusion.','movie where the hero dies in the end').includes('Tony Stark'),false);checks++;
assert.equal(protectEndingSpoilers('Maximus dies in the arena. A historical action drama.','movie where the hero dies in the end').includes('Maximus'),false);checks++;
assert.equal(protectEndingSpoilers('Tony Stark dies.','Who dies? Spoilers please.'),'Tony Stark dies.');checks++;
console.log(`${checks} descriptive clue, routing, typo, occasion, venue, title and abstention checks passed.`);
