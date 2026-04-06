const assert = require("assert");
const { parseReelbotIntent } = require("../ai/intentParser");
const { passesStrictIntentFilter, getMovieThemeMatchScore } = require("../ai/strictIntentFilters");

const intent = parseReelbotIntent("toddler friendly movie about easter");

const safeEasterMovie = {
  id: 1,
  title: "Hop",
  overview: "A playful Easter Bunny adventure for the whole family.",
  genre_ids: [35, 10751, 12],
  adult: false,
  us_certification: "PG",
};

const expandedThemeMovie = {
  id: 2,
  title: "Peter Rabbit",
  overview: "A mischievous rabbit stirs up springtime trouble in a light family comedy.",
  genre_ids: [35, 10751, 12],
  adult: false,
  us_certification: "PG",
};

const unsafeMovie = {
  id: 3,
  title: "Mad Max: Fury Road",
  overview: "In a post-apocalyptic wasteland, a drifter fights through violent chaos and disaster.",
  genre_ids: [28, 53],
  adult: false,
  us_certification: "R",
};

assert(passesStrictIntentFilter(safeEasterMovie, intent), "direct Easter family movie should pass strict filter");
assert(!passesStrictIntentFilter(expandedThemeMovie, intent), "expanded-theme-only movie should not pass the strict first pass");
assert(passesStrictIntentFilter(expandedThemeMovie, intent, { allowExpandedThemes: true }), "expanded-theme movie should pass fallback expansion");
assert(!passesStrictIntentFilter(unsafeMovie, intent), "unsafe intense movie should fail toddler guardrails");
assert(getMovieThemeMatchScore(safeEasterMovie, intent.strict_filters) > 0, "strict theme score should be positive for Easter match");

console.log("Strict intent filter checks passed.");
