const compact = (value = "") => String(value || "").replace(/\s+/g, " ").trim();
const lower = (value = "") => compact(value).toLowerCase();

const TIME_CONSTRAINT_RELAXATION_YEARS = 2;
const TIME_CONSTRAINT_MIN_STRICT_CANDIDATES = 5;

const TIME_CONSTRAINT_DECADES = [
  { pattern: /\b(70s|70's|seventies|1970s|1970's)\b/i, label: "70s", min: 1970, max: 1979 },
  { pattern: /\b(80s|80's|eighties|1980s|1980's|eighties-era|eighties style)\b/i, label: "80s", min: 1980, max: 1989 },
  { pattern: /\b(90s|90's|nineties|1990s|1990's|nineties-era|nineties style)\b/i, label: "90s", min: 1990, max: 1999 },
  { pattern: /\b(2000s|2000's|two ?thousands|two ?thousand s|aughts|00s|00's|noughties)\b/i, label: "2000s", min: 2000, max: 2009 },
  { pattern: /\b(2010s|2010's|twenty ?tens|2010s-era|2010's-era)\b/i, label: "2010s", min: 2010, max: 2019 },
];

const clampYear = (year = 0) => Math.max(1900, Math.min(2100, Math.round(year)));

const isSettingContext = (prompt = "", matchIndex = 0) => {
  const leadingWindow = String(prompt || "")
    .slice(Math.max(0, matchIndex - 28), matchIndex)
    .toLowerCase();

  return /(set|takes place|taking place|placed)\s+(squarely\s+|firmly\s+)?(in|during)\s+(the\s+)?$/.test(leadingWindow);
};

const buildRange = (min, max) => ({
  min_year: clampYear(min),
  max_year: clampYear(max),
});

const buildTimeConstraint = ({ type, label, min, max }) => {
  const range = buildRange(min, max);
  const relaxedRange = buildRange(
    range.min_year - TIME_CONSTRAINT_RELAXATION_YEARS,
    range.max_year + TIME_CONSTRAINT_RELAXATION_YEARS
  );
  const fallbackNote = type === "year"
    ? `Not strictly ${label}, but the closest strong fit right around it.`
    : `Just outside the decade, but closer in tone than most exact-era options.`;

  return {
    type,
    label,
    strict: true,
    start_year: range.min_year,
    end_year: range.max_year,
    range,
    relaxed_range: relaxedRange,
    fallback_type: type === "year" ? "outside_year_but_close" : "outside_decade_but_close",
    fallback_note: fallbackNote,
    yearConstraint: type === "year"
      ? {
          type: "year",
          year: range.min_year,
          strict: true,
        }
      : {
          type: "decade",
          startYear: range.min_year,
          endYear: range.max_year,
          strict: true,
        },
  };
};

const parseExplicitTimeConstraint = (prompt = "") => {
  const normalizedPrompt = lower(prompt);
  if (!normalizedPrompt) {
    return null;
  }

  for (const entry of TIME_CONSTRAINT_DECADES) {
    const match = entry.pattern.exec(normalizedPrompt);
    if (match && !isSettingContext(normalizedPrompt, match.index || 0)) {
      return buildTimeConstraint({
        type: "decade",
        label: entry.label,
        min: entry.min,
        max: entry.max,
      });
    }
  }

  const yearPattern = /\b(19[0-9]{2}|20[0-9]{2})\b/g;
  let yearMatch = yearPattern.exec(normalizedPrompt);
  while (yearMatch) {
    if (!isSettingContext(normalizedPrompt, yearMatch.index || 0)) {
      const year = clampYear(Number(yearMatch[0]));
      return buildTimeConstraint({
        type: "year",
        label: `${year}`,
        min: year,
        max: year,
      });
    }
    yearMatch = yearPattern.exec(normalizedPrompt);
  }

  return null;
};

const getMovieReleaseYear = (movie = {}) => {
  const releaseDate = String(movie?.release_date || "").trim();
  if (!releaseDate) {
    return null;
  }

  const match = releaseDate.match(/(\d{4})/);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  return Number.isFinite(year) ? year : null;
};

const filterMoviesByYearRange = (movies = [], range = {}) => {
  if (!range || !Number.isFinite(range.min_year) || !Number.isFinite(range.max_year)) {
    return Array.isArray(movies) ? movies.slice() : [];
  }

  const minYear = Number(range.min_year);
  const maxYear = Number(range.max_year);
  return (Array.isArray(movies) ? movies : []).filter((movie) => {
    const year = getMovieReleaseYear(movie);
    return Boolean(year && year >= minYear && year <= maxYear);
  });
};

const applyTimeConstraintFilterToPool = (movies = [], intent = {}, options = {}) => {
  const constraint = intent?.hard_filters?.time_constraint;
  const allowFallback = Boolean(options.allowFallback);
  const minStrictCandidates = Number(options.minStrictCandidates || TIME_CONSTRAINT_MIN_STRICT_CANDIDATES);

  if (!constraint?.range || !Number.isFinite(constraint.range.min_year) || !Number.isFinite(constraint.range.max_year)) {
    return {
      movies: Array.isArray(movies) ? movies : [],
      strictMovies: Array.isArray(movies) ? movies : [],
      fallbackMovies: [],
      canFallback: false,
      fallbackNote: null,
    };
  }

  const strictMatches = filterMoviesByYearRange(movies, constraint.range);
  const relaxedMatches = constraint.relaxed_range
    ? filterMoviesByYearRange(movies, constraint.relaxed_range)
    : strictMatches.slice();
  const canFallback = relaxedMatches.length > strictMatches.length && strictMatches.length < minStrictCandidates;
  const usedRelaxedRange = allowFallback && canFallback;
  const appliedRange = usedRelaxedRange ? constraint.relaxed_range : constraint.range;
  const filteredMovies = usedRelaxedRange ? relaxedMatches : strictMatches;

  const updatedConstraint = {
    ...constraint,
    applied_range: appliedRange,
    original_range: constraint.range,
    used_relaxed_range: usedRelaxedRange,
  };

  intent.hard_filters = {
    ...intent.hard_filters,
    time_constraint: updatedConstraint,
    min_release_year: Number(appliedRange.min_year),
    max_release_year: Number(appliedRange.max_year),
  };

  intent.time_constraint_state = {
    label: constraint.label,
    type: constraint.type,
    relaxed: usedRelaxedRange,
    fallback_type: usedRelaxedRange ? constraint.fallback_type : null,
    range: appliedRange,
    original_range: constraint.range,
    expanded_range: usedRelaxedRange ? constraint.relaxed_range : null,
    fallback_note: usedRelaxedRange ? (constraint.fallback_note || null) : null,
    strict_candidate_count: strictMatches.length,
    relaxed_candidate_count: relaxedMatches.length,
  };

  return {
    movies: filteredMovies,
    strictMovies: strictMatches,
    fallbackMovies: canFallback ? relaxedMatches : [],
    canFallback,
    fallbackNote: usedRelaxedRange ? (constraint.fallback_note || null) : null,
  };
};

module.exports = {
  TIME_CONSTRAINT_MIN_STRICT_CANDIDATES,
  applyTimeConstraintFilterToPool,
  detectTimeConstraint: parseExplicitTimeConstraint,
  filterMoviesByYearRange,
  getMovieReleaseYear,
  parseExplicitTimeConstraint,
};
