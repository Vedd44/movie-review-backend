const assert = require("assert");
const {
  buildTimeConstraintDiscoverVariants,
  buildTimeConstraintGenreFilter,
  buildTimeConstraintRangeParams,
} = require("../ai/timeConstraintRetrieval");

const constraint = {
  range: { min_year: 1990, max_year: 1999 },
  original_range: { min_year: 1990, max_year: 1999 },
  relaxed_range: { min_year: 1988, max_year: 2001 },
};

const genreFilter = buildTimeConstraintGenreFilter({
  structuredGenreIds: [28],
  preferredGenreIds: [28, 53],
  softBoostGenreIds: [53, 12],
});

assert.strictEqual(genreFilter, "28|53|12", "genre filter should merge and dedupe structured and intent genres");

const strictRangeParams = buildTimeConstraintRangeParams(constraint);
assert.deepStrictEqual(strictRangeParams, {
  "primary_release_date.gte": "1990-01-01",
  "primary_release_date.lte": "1999-12-31",
  "release_date.gte": "1990-01-01",
  "release_date.lte": "1999-12-31",
}, "strict range params should stay inside the requested decade");

const relaxedRangeParams = buildTimeConstraintRangeParams(constraint, { allowFallback: true });
assert.deepStrictEqual(relaxedRangeParams, {
  "primary_release_date.gte": "1988-01-01",
  "primary_release_date.lte": "2001-12-31",
  "release_date.gte": "1988-01-01",
  "release_date.lte": "2001-12-31",
}, "relaxed range params should only widen to the narrow fallback window");

const strictVariants = buildTimeConstraintDiscoverVariants({
  constraint,
  genreFilter,
  runtimeRange: { max: 120 },
});

assert.strictEqual(strictVariants.length, 3, "time-constrained retrieval should create three discover variants");
assert.strictEqual(strictVariants[0].params.with_genres, "28|53|12", "discover variants should carry the merged genre filter");
assert.strictEqual(strictVariants[0].params["with_runtime.lte"], 120, "runtime ceiling should carry into strict discover variants");
assert.strictEqual(strictVariants[0].params["primary_release_date.lte"], "1999-12-31", "strict discover variants should remain inside the decade");
assert.strictEqual(strictVariants[2].params.sort_by, "vote_average.desc", "one variant should widen by ratings instead of popularity");

const relaxedVariants = buildTimeConstraintDiscoverVariants({
  constraint,
  allowFallback: true,
  genreFilter,
});

assert.strictEqual(relaxedVariants[0].params["primary_release_date.gte"], "1988-01-01", "fallback variants should use the narrow expanded range");
assert.strictEqual(relaxedVariants[0].params["primary_release_date.lte"], "2001-12-31", "fallback variants should not drift to modern years");

console.log("Time-constrained retrieval helpers behave as expected.");
