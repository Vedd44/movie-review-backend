const slugify = (value = "") =>
  String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const getReleaseYear = (movie = {}) => {
  const year = Number.parseInt(String(movie.release_date || "").slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
};

const getMovieSlug = (movie = {}) => {
  const titleSlug = slugify(movie.title || movie.original_title || "movie") || "movie";
  const year = getReleaseYear(movie);
  return year ? `${titleSlug}-${year}` : titleSlug;
};

const getPersonCollisionToken = (personId) => {
  let hash = 2166136261;
  for (const character of String(personId || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 5).padStart(5, "0");
};

const getPersonSlug = (person = {}, options = {}) => {
  const baseSlug = slugify(person.name || "person") || "person";
  return options.disambiguate && person.id ? `${baseSlug}--${getPersonCollisionToken(person.id)}` : baseSlug;
};
const buildMovieCanonicalPath = (movie = {}) => `/movies/${getMovieSlug(movie)}`;
const buildPersonCanonicalPath = (person = {}) => `/people/${getPersonSlug(person)}`;

const parseMovieSlug = (slug = "") => {
  const normalizedSlug = slugify(slug);
  const yearMatch = normalizedSlug.match(/-(\d{4})$/);
  const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : null;
  const titleSlug = yearMatch ? normalizedSlug.slice(0, -5) : normalizedSlug;
  return {
    normalizedSlug,
    titleSlug,
    titleQuery: titleSlug.replace(/-/g, " "),
    year,
  };
};

const rankMovieSlugMatches = (movies = [], requestedSlug = "") => {
  const parsed = parseMovieSlug(requestedSlug);
  return (Array.isArray(movies) ? movies : [])
    .filter((movie) => movie?.id && !movie.adult)
    .map((movie) => ({
      movie,
      exactTitle: [movie.title, movie.original_title].some((title) => slugify(title) === parsed.titleSlug),
      exactYear: Boolean(parsed.year && getReleaseYear(movie) === parsed.year),
    }))
    .sort((left, right) =>
      Number(right.exactTitle) - Number(left.exactTitle)
      || Number(right.exactYear) - Number(left.exactYear)
      || Number(right.movie.popularity || 0) - Number(left.movie.popularity || 0)
      || Number(right.movie.vote_count || 0) - Number(left.movie.vote_count || 0)
      || Number(left.movie.id) - Number(right.movie.id)
    )
    .map((entry) => entry.movie);
};

const rankPersonSlugMatches = (people = [], requestedSlug = "") => {
  const normalizedSlug = slugify(requestedSlug);
  const collisionMatch = String(requestedSlug || "").match(/--([a-z0-9]{5})$/i);
  const requestedToken = collisionMatch?.[1]?.toLowerCase() || "";
  const requestedNameSlug = collisionMatch ? slugify(String(requestedSlug).slice(0, collisionMatch.index)) : normalizedSlug;
  return (Array.isArray(people) ? people : [])
    .filter((person) => person?.id)
    .sort((left, right) =>
      Number(requestedToken && getPersonCollisionToken(right.id) === requestedToken) - Number(requestedToken && getPersonCollisionToken(left.id) === requestedToken)
      || Number(getPersonSlug(right) === requestedNameSlug) - Number(getPersonSlug(left) === requestedNameSlug)
      || Number(right.popularity || 0) - Number(left.popularity || 0)
      || Number(left.id) - Number(right.id)
    );
};

const getGenreIds = (movie = {}) => new Set(
  (Array.isArray(movie.genre_ids) ? movie.genre_ids : Array.isArray(movie.genres) ? movie.genres.map((genre) => genre?.id) : [])
    .map(Number)
    .filter(Boolean)
);

const rankRelatedMovies = (movie = {}, limit = 6) => {
  const targetGenreIds = getGenreIds(movie);
  const candidates = new Map();

  const addCandidates = (items, source) => {
    (Array.isArray(items) ? items : []).forEach((candidate) => {
      if (!candidate?.id || candidate.id === movie.id || candidate.adult || !candidate.poster_path) return;
      const existing = candidates.get(candidate.id);
      if (!existing || source === "recommendations") {
        candidates.set(candidate.id, { ...candidate, relation_source: source });
      }
    });
  };

  addCandidates(movie.recommendations?.results, "recommendations");
  addCandidates(movie.similar?.results, "similar");

  return Array.from(candidates.values())
    .map((candidate) => {
      const candidateGenres = getGenreIds(candidate);
      const genreOverlap = Array.from(candidateGenres).filter((genreId) => targetGenreIds.has(genreId)).length;
      const voteCount = Number(candidate.vote_count || 0);
      const score = genreOverlap * 50
        + (candidate.relation_source === "recommendations" ? 35 : 0)
        + Math.log10(voteCount + 1) * 8
        + Number(candidate.vote_average || 0) * 2
        + Math.min(Number(candidate.popularity || 0) / 4, 25)
        - (genreOverlap === 1 ? 30 : 0);
      return { candidate, genreOverlap, score };
    })
    .filter(({ candidate, genreOverlap }) =>
      (!targetGenreIds.size || genreOverlap > 0)
      && (Number(candidate.vote_count || 0) >= 150 || Number(candidate.popularity || 0) >= 12)
    )
    .sort((left, right) => right.score - left.score || Number(left.candidate.id) - Number(right.candidate.id))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
};

module.exports = {
  buildMovieCanonicalPath,
  buildPersonCanonicalPath,
  getMovieSlug,
  getPersonCollisionToken,
  getPersonSlug,
  parseMovieSlug,
  rankMovieSlugMatches,
  rankPersonSlugMatches,
  rankRelatedMovies,
  slugify,
};
