const assert = require("assert");
const {
  buildMovieCanonicalPath,
  buildPersonCanonicalPath,
  getPersonCollisionToken,
  parseMovieSlug,
  rankMovieSlugMatches,
  rankPersonSlugMatches,
  rankRelatedMovies,
} = require("../src/moviePresentation");

assert.strictEqual(buildMovieCanonicalPath({ title: "Aliens", release_date: "1986-07-18" }), "/movies/aliens-1986");
assert.strictEqual(buildPersonCanonicalPath({ name: "James Cameron" }), "/people/james-cameron");
assert.deepStrictEqual(parseMovieSlug("aliens-1986"), {
  normalizedSlug: "aliens-1986",
  titleSlug: "aliens",
  titleQuery: "aliens",
  year: 1986,
});

const movieMatches = rankMovieSlugMatches([
  { id: 2, title: "Aliens", release_date: "2024-01-01", popularity: 90 },
  { id: 1, title: "Aliens", release_date: "1986-07-18", popularity: 50 },
], "aliens-1986");
assert.strictEqual(movieMatches[0].id, 1, "title and year should resolve deterministically");

const personMatches = rankPersonSlugMatches([
  { id: 20, name: "Alex Smith", popularity: 100 },
  { id: 10, name: "Alex Smith", popularity: 1 },
], "alex-smith");
assert.strictEqual(personMatches[0].id, 10, "the oldest stable TMDB ID should own the clean slug regardless of popularity");
const reorderedPersonMatches = rankPersonSlugMatches([
  { id: 10, name: "Alex Smith", popularity: 500 },
  { id: 20, name: "Alex Smith", popularity: 0 },
], "alex-smith");
assert.strictEqual(reorderedPersonMatches[0].id, 10, "popularity changes must not transfer clean-slug ownership");
const disambiguatedPersonMatches = rankPersonSlugMatches([
  { id: 20, name: "Alex Smith", popularity: 4 },
  { id: 10, name: "Alex Smith", popularity: 12 },
], `alex-smith--${getPersonCollisionToken(20)}`);
assert.strictEqual(disambiguatedPersonMatches[0].id, 20, "opaque collision suffixes should preserve the intended person");

const related = rankRelatedMovies({
  id: 679,
  genres: [{ id: 28 }, { id: 878 }, { id: 53 }],
  recommendations: {
    results: [
      { id: 100, title: "The Terminator", genre_ids: [28, 878, 53], poster_path: "/terminator.jpg", vote_count: 13000, vote_average: 7.7, popularity: 50 },
      { id: 101, title: "Avatar", genre_ids: [28, 12, 878], poster_path: "/avatar.jpg", vote_count: 32000, vote_average: 7.6, popularity: 80 },
    ],
  },
  similar: {
    results: [
      { id: 102, title: "Miss Congeniality 2", genre_ids: [28, 35, 80], poster_path: "/miss.jpg", vote_count: 1800, vote_average: 5.8, popularity: 18 },
      { id: 103, title: "End of Days", genre_ids: [28, 14, 27], poster_path: "/end.jpg", vote_count: 1900, vote_average: 6.1, popularity: 20 },
    ],
  },
});
assert.deepStrictEqual(related.slice(0, 2).map((movie) => movie.title), ["The Terminator", "Avatar"]);

const { isMovieSlugMatch } = require("../src/moviePresentation");
assert.equal(isMovieSlugMatch({id:1,title:"Dr. Rage",release_date:"2005-01-01"}, "hostel-2005"), false);
assert.equal(isMovieSlugMatch({id:2,title:"Hostel",release_date:"2006-01-06"}, "hostel-2005"), true);
assert.equal(isMovieSlugMatch({id:3,title:"Julie & Julia",release_date:"2009-01-01"}, "julie-and-julia-2009"), true);
assert.equal(isMovieSlugMatch({id:4,title:"The School of Rock",release_date:"2003-01-01"}, "school-of-rock-2003"), true);
assert.equal(isMovieSlugMatch({id:5,title:"The Invitation",release_date:"2022-01-01"}, "the-invitation-2015"), false);
assert.equal(isMovieSlugMatch({id:6,title:"Deadly Games",release_date:""}, "deadly-games-1989"), false);

console.log("Movie presentation tests passed.");
