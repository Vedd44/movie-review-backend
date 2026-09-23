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

console.log("Ask ReelBot intent routing checks passed.");
