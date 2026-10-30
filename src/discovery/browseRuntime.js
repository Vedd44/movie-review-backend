const hasBrowseRuntimeFilter = (runtime) => ["under_two_hours", "over_two_hours"].includes(runtime);

const matchesBrowseRuntime = (minutes, runtime) => {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return false;
  return runtime === "under_two_hours" ? value < 120 : value >= 120;
};

const runtimeUnavailable = () => Object.assign(new Error("Movie lengths are temporarily unavailable. Please try again shortly."), { code: "BROWSE_RUNTIME_UNAVAILABLE" });

// Discover responses omit runtime, and upstream filtering is not authoritative.
// Verify facts before returning filtered Browse results; never fill with unknowns.
const verifyBrowseRuntimes = async (movies = [], runtime, fetchDetails, limit = Infinity, { timeoutMs = 5000 } = {}) => {
  if (!hasBrowseRuntimeFilter(runtime)) return movies;
  const verified = new Array(movies.length);
  let next = 0;
  let matched = 0;
  let stopped = false;
  let timer;
  const work = Promise.all(Array.from({ length: Math.min(5, movies.length) }, async () => {
    while (!stopped && next < movies.length && matched < limit) {
      const index = next++;
      const movie = movies[index];
      if (!movie?.id) continue;
      try {
        const details = await fetchDetails(movie.id);
        if (matchesBrowseRuntime(details?.runtime, runtime)) {
          verified[index] = { ...movie, runtime: Number(details.runtime) };
          matched += 1;
        }
      } catch (_) {
        stopped = true;
        throw runtimeUnavailable();
      }
    }
  }));
  try {
    await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => { stopped = true; reject(runtimeUnavailable()); }, timeoutMs);
    })]);
    return verified.filter(Boolean).slice(0, limit);
  } finally {
    stopped = true;
    clearTimeout(timer);
  }
};

module.exports = { hasBrowseRuntimeFilter, matchesBrowseRuntime, verifyBrowseRuntimes };
