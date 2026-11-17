const assert = require("node:assert/strict");
const { ASK_INTENTS, classifyAskIntent } = require("../src/ask/askIntent");

const moviePage = (title) => ({ page: "movie_detail", movie: { id: 1, title } });

assert.equal(
  classifyAskIntent({ prompt: "is this movie scary?", context: moviePage("Coyote vs. Acme") }),
  ASK_INTENTS.CURRENT_MOVIE_QUESTION
);
assert.equal(
  classifyAskIntent({ prompt: "something like this but less scary", context: moviePage("Alien") }),
  ASK_INTENTS.MOVIE_RECOMMENDATION
);
assert.equal(
  classifyAskIntent({ prompt: "who's in this?", context: moviePage("By Any Means") }),
  ASK_INTENTS.CURRENT_MOVIE_QUESTION
);
assert.equal(
  classifyAskIntent({ prompt: "should I watch this or Alien?", context: moviePage("Paddington 2") }),
  ASK_INTENTS.MOVIE_COMPARISON
);
assert.equal(
  classifyAskIntent({ prompt: "is this good for a 5 year old?", context: moviePage("Paddington 2") }),
  ASK_INTENTS.CURRENT_MOVIE_QUESTION
);
assert.equal(
  classifyAskIntent({ prompt: "just pick one", context: { page: "browse", activeFilters: { genre: "thriller", runtime: "under_two_hours" } } }),
  ASK_INTENTS.CURRENT_SET_RECOMMENDATION
);
assert.equal(
  classifyAskIntent({ prompt: "pick something easy tonight", context: { page: "my_movies" } }),
  ASK_INTENTS.ACCOUNT_LIBRARY_RECOMMENDATION
);
const homepagePickContext = { page: "home", currentPick: { id: 393, title: "Knives Out" } };
assert.equal(
  classifyAskIntent({ prompt: "What movies are out now that I might like?", context: homepagePickContext }),
  ASK_INTENTS.GENERAL_RECOMMENDATION
);
assert.equal(
  classifyAskIntent({ prompt: "Something gentler", context: homepagePickContext }),
  ASK_INTENTS.REFINE_RECOMMENDATION
);

assert.equal(
  classifyAskIntent({ prompt: "What was that movie where a guy wakes up every day with no memory?", context: { page: "home" } }),
  ASK_INTENTS.MOVIE_IDENTIFICATION
);
assert.equal(
  classifyAskIntent({ prompt: "Which film was that with the hotel and the backwards dream levels?", context: { page: "home" } }),
  ASK_INTENTS.MOVIE_IDENTIFICATION
);

console.log("Ask ReelBot intent routing checks passed.");

// An explicit new plan resets the search; ordinary corrections must still refine it.
const priorSearch = { activeIntent: ASK_INTENTS.CURRENT_MOVIE_QUESTION, activeTask: ASK_INTENTS.GENERAL_RECOMMENDATION, activeRequest: 'A funny movie under 100 minutes', anchorMovie: { id: 4951 } };
for (const prompt of ['Actually change of plan: a serious political thriller from the 1970s, no comedy.', 'Change of plans: a long drama', 'Actually, new plan: a horror film']) {
  assert.equal(classifyAskIntent({ prompt, context: { page: 'browse' }, conversation: priorSearch }), ASK_INTENTS.GENERAL_RECOMMENDATION, prompt);
}
for (const prompt of ['Actually, make it shorter', 'Actually under 90 minutes', 'Another one, same restrictions']) {
  assert.equal(classifyAskIntent({ prompt, context: { page: 'browse' }, conversation: priorSearch }), ASK_INTENTS.REFINE_RECOMMENDATION, prompt);
}
assert.equal(classifyAskIntent({ prompt: 'Why does the character have a change of plan?', context: moviePage('Heat'), conversation: priorSearch }), ASK_INTENTS.CURRENT_MOVIE_QUESTION);
