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

const sceneIntent=parseReelbotIntent('Recommend a movie where a man cannot form memories and investigates a murder');
const clueMovie={id:77,title:'Memento',overview:'A man tracks down his wife’s killer despite a damaged short-term memory.',genre_ids:[9648,53],plot_discovered:true};
assert(passesStrictIntentFilter(clueMovie,sceneIntent),'semantic plot candidates survive missing literal inferred-theme keywords');
assert(!passesStrictIntentFilter({...clueMovie,plot_discovered:false},sceneIntent),'ordinary feed candidates retain the theme prefilter');
assert(!passesStrictIntentFilter({...unsafeMovie,plot_discovered:true},{...intent,raw_prompt:'A movie where children celebrate Easter'}),'semantic discovery never bypasses child safety');
assert(!passesStrictIntentFilter({...clueMovie,plot_discovered:true},{...sceneIntent,raw_prompt:'A good mystery movie'}),'ordinary genre requests retain literal theme checks');
console.log("Strict intent filter checks passed.");
