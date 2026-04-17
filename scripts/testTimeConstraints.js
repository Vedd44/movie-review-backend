const assert = require("assert");
const { parseReelbotIntent } = require("../ai/intentParser");
const { applyTimeConstraintFilterToPool } = require("../ai/timeConstraints");

const makeMovie = (id, title, releaseDate, genreIds = [28]) => ({
  id,
  title,
  release_date: releaseDate,
  genre_ids: genreIds,
});

const cloneIntent = (intent) => JSON.parse(JSON.stringify(intent));

const strictNinetiesIntent = parseReelbotIntent("90s action movie");
assert.strictEqual(strictNinetiesIntent.hard_filters.time_constraint.type, "decade", "90s query should parse as a decade");
assert.strictEqual(strictNinetiesIntent.hard_filters.time_constraint.range.min_year, 1990, "90s query should start at 1990");
assert.strictEqual(strictNinetiesIntent.hard_filters.time_constraint.range.max_year, 1999, "90s query should end at 1999");
assert.strictEqual(strictNinetiesIntent.hard_filters.time_constraint.strict, true, "90s query should be strict");

const eightiesIntent = parseReelbotIntent("80s sci-fi");
assert.strictEqual(eightiesIntent.hard_filters.time_constraint.range.min_year, 1980, "80s query should start at 1980");
assert.strictEqual(eightiesIntent.hard_filters.time_constraint.range.max_year, 1989, "80s query should end at 1989");

const yearIntent = parseReelbotIntent("1994 thriller");
assert.strictEqual(yearIntent.hard_filters.time_constraint.type, "year", "1994 query should parse as an exact year");
assert.strictEqual(yearIntent.hard_filters.time_constraint.range.min_year, 1994, "1994 query should lock to 1994");
assert.strictEqual(yearIntent.hard_filters.time_constraint.range.max_year, 1994, "1994 query should lock to 1994");

const settingIntent = parseReelbotIntent("crime movie set in the 90s");
assert.strictEqual(settingIntent.hard_filters.time_constraint, null, "\"set in the 90s\" should not become a release-decade filter");

const mixedPool = [
  makeMovie(1, "Strict Nineties One", "1991-07-11"),
  makeMovie(2, "Strict Nineties Two", "1997-06-06"),
  makeMovie(3, "Outside Year", "2026-03-20"),
];

const strictFilterIntent = cloneIntent(strictNinetiesIntent);
const strictResult = applyTimeConstraintFilterToPool(mixedPool, strictFilterIntent, { allowFallback: false });
assert.deepStrictEqual(
  strictResult.movies.map((movie) => movie.id),
  [1, 2],
  "strict decade filtering should keep only 1990-1999 titles"
);
assert.strictEqual(strictFilterIntent.time_constraint_state.relaxed, false, "strict pass should not activate fallback");

const thinStrictPool = [
  makeMovie(10, "Borderline 1988", "1988-05-01"),
  makeMovie(11, "Exact 1991", "1991-07-11"),
  makeMovie(12, "Near 2001", "2001-02-02"),
  makeMovie(13, "Far Future 2026", "2026-08-08"),
];

const fallbackCandidateIntent = cloneIntent(strictNinetiesIntent);
const preFallbackResult = applyTimeConstraintFilterToPool(thinStrictPool, fallbackCandidateIntent, { allowFallback: false });
assert.strictEqual(preFallbackResult.canFallback, true, "thin strict pool should advertise a narrow fallback");
assert.deepStrictEqual(
  preFallbackResult.fallbackMovies.map((movie) => movie.id),
  [10, 11, 12],
  "fallback pool should only expand narrowly around the decade"
);
assert(!preFallbackResult.fallbackMovies.some((movie) => movie.id === 13), "fallback pool must not jump to far-off years like 2026");

const fallbackIntent = cloneIntent(strictNinetiesIntent);
const relaxedResult = applyTimeConstraintFilterToPool(thinStrictPool, fallbackIntent, { allowFallback: true });
assert.deepStrictEqual(
  relaxedResult.movies.map((movie) => movie.id),
  [10, 11, 12],
  "explicit fallback should widen only to the approved near-decade pool"
);
assert.strictEqual(fallbackIntent.time_constraint_state.relaxed, true, "explicit fallback should mark the relaxed state");
assert.strictEqual(fallbackIntent.time_constraint_state.fallback_type, "outside_decade_but_close", "fallback type should be explicit");

const persistedIntent = cloneIntent(strictNinetiesIntent);
const firstPass = applyTimeConstraintFilterToPool(mixedPool, persistedIntent, { allowFallback: false });
assert.deepStrictEqual(firstPass.movies.map((movie) => movie.id), [1, 2], "first recommendation pass should stay strict");
const swapPass = applyTimeConstraintFilterToPool(mixedPool.filter((movie) => movie.id !== 1), persistedIntent, { allowFallback: false });
assert.deepStrictEqual(swapPass.movies.map((movie) => movie.id), [2], "follow-on picks should preserve the original decade constraint");

console.log("Time constraint parsing and filtering checks passed.");
