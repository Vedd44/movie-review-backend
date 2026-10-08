const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { parseReelbotIntent } = require("../ai/intentParser");
const { getEntitySearchPrompt, trimEntityQualifier } = require("../ai/entityPrompt");

// Exercise the actual resolver with deterministic TMDB replies, including the
// misleading collection that caused the production failure.
const source = fs.readFileSync(require.resolve("../index.js"), "utf8");
const calls = [];
const context = vm.createContext({
  getEntitySearchPrompt, trimEntityQualifier, console,
  fetchTmdb: async (path, params) => {
    calls.push({ path, query: params.query });
    const results = path === "/search/collection"
      ? [{ id: 1092503, name: "Friends Forever" }, { id: 404609, name: "John Wick Collection" }]
      : path === "/search/person"
        ? [{ id: 6384, name: "Keanu Reeves", known_for_department: "Acting" }, { id: 525, name: "Christopher Nolan", known_for_department: "Directing" }]
        : [{ id: 157336, title: "Interstellar" }];
    return { results };
  },
});
vm.runInContext(source.slice(source.indexOf("const PERSON_WITH_PATTERNS"), source.indexOf("const getIntentQueryType")) + "\nthis.resolve = resolveEntityAnchor;", context);

(async () => {
  for (const prompt of ["Good with friends", "good with my friends", "movies with friends", "a movie to watch with family", "watch with my partner"]) {
    calls.length = 0;
    assert.equal(await context.resolve(prompt, parseReelbotIntent(prompt)), null, prompt);
    assert.equal(calls.length, 0, `${prompt}: no unnecessary entity API calls`);
  }
  for (const [prompt, kind, id] of [
    ["movies with Keanu Reeves", "actor", 6384],
    ["A movie starring Keanu Reeves, not just a cameo", "actor", 6384],
    ["I loved Interstellar, something with that sense of wonder", "movie_title", 157336],
    ["movies with Keanu Reeves with friends", "actor", 6384],
    ["Christopher Nolan", "director", 525],
    ["movies like Interstellar", "movie_title", 157336],
    ["John Wick", "franchise", 404609],
    ["John Wick with friends", "franchise", 404609],
  ]) {
    const result = await context.resolve(prompt, parseReelbotIntent(prompt));
    assert.equal(result?.kind, kind, prompt);
    assert.equal(result?.id, id, prompt);
  }
  assert.equal(parseReelbotIntent('I loved Interstellar, something with that sense of wonder').anchors.title,'Interstellar');
  for (const name of ['Paris, Texas','Robert Downey Jr.','Me and Earl and the Dying Girl','Withnail & I']) assert.equal(trimEntityQualifier(name),name);
  const genreContext = vm.createContext({
    getGenreFilterIds: () => [],
    PICK_COMPANY_CONFIG: { friends: { genreIds: [28, 35, 53] } },
  });
  vm.runInContext(source.slice(source.indexOf("const getPickGenreParam"), source.indexOf("const isLowSignalMovie")) + '\nthis.result = getPickGenreParam({genre:"all",mood:"all",company:"friends"});', genreContext);
  assert.equal(genreContext.result, undefined, "Broad group watching must not require unrelated genres simultaneously");
  console.log("Watch-company routing, zero-lookup fast path, named entities and group genre regression checks passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
