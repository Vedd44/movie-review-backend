const uniqueNumericIds = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => Number.parseInt(value, 10)).filter(Boolean)));

const buildTimeConstraintGenreFilter = ({
  structuredGenreIds = [],
  preferredGenreIds = [],
  softBoostGenreIds = [],
} = {}) => {
  const genreIds = uniqueNumericIds([
    ...structuredGenreIds,
    ...preferredGenreIds,
    ...softBoostGenreIds,
  ]);

  return genreIds.length ? genreIds.join("|") : undefined;
};

const buildTimeConstraintRangeParams = (constraint = {}, options = {}) => {
  const safeConstraint = constraint || {};
  const allowFallback = Boolean(options.allowFallback);
  const range = allowFallback
    ? safeConstraint.relaxed_range || safeConstraint.range || null
    : safeConstraint.original_range || safeConstraint.range || null;

  if (!range?.min_year || !range?.max_year) {
    return {};
  }

  return {
    "primary_release_date.gte": `${range.min_year}-01-01`,
    "primary_release_date.lte": `${range.max_year}-12-31`,
    "release_date.gte": `${range.min_year}-01-01`,
    "release_date.lte": `${range.max_year}-12-31`,
  };
};

const buildTimeConstraintDiscoverVariants = ({
  constraint = {},
  allowFallback = false,
  genreFilter,
  runtimeRange = {},
} = {}) => {
  const rangeParams = buildTimeConstraintRangeParams(constraint, { allowFallback });
  if (!Object.keys(rangeParams).length) {
    return [];
  }

  const baseParams = {
    region: "US",
    include_adult: "false",
    with_release_type: "2|3",
    without_genres: "99,10770",
    ...rangeParams,
  };

  if (genreFilter) {
    baseParams.with_genres = genreFilter;
  }

  if (Number.isFinite(runtimeRange.min) && runtimeRange.min > 0) {
    baseParams["with_runtime.gte"] = runtimeRange.min;
  }

  if (Number.isFinite(runtimeRange.max) && runtimeRange.max > 0) {
    baseParams["with_runtime.lte"] = runtimeRange.max;
  }

  return [
    {
      label: "time_constraint_popularity_page1",
      params: {
        ...baseParams,
        page: 1,
        sort_by: "popularity.desc",
        "vote_count.gte": 40,
        "vote_average.gte": 5,
      },
    },
    {
      label: "time_constraint_popularity_page2",
      params: {
        ...baseParams,
        page: 2,
        sort_by: "popularity.desc",
        "vote_count.gte": 25,
        "vote_average.gte": 4.8,
      },
    },
    {
      label: "time_constraint_ratings_page1",
      params: {
        ...baseParams,
        page: 1,
        sort_by: "vote_average.desc",
        "vote_count.gte": 120,
        "vote_average.gte": 6.2,
      },
    },
  ];
};

module.exports = {
  buildTimeConstraintDiscoverVariants,
  buildTimeConstraintGenreFilter,
  buildTimeConstraintRangeParams,
};
