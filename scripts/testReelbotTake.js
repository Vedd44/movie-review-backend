const assert = require("node:assert/strict");
const {
  REELBOT_TAKE_VERSION,
  validateReelbotTake,
  createReelbotTakeService,
} = require("../src/takes/reelbotTake");

const movie = {
  id: 346648,
  title: "Paddington 2",
  description: "Paddington tries to buy a present for his aunt.",
  runtime: 104,
  genre_names: ["Adventure", "Comedy", "Family"],
  keyword_names: ["kindness", "family", "prison"],
};

const validTake = {
  assessment: "A warm, brisk family adventure whose comic complications keep returning to kindness, trust, and the pleasure of good company.",
  good_fit_if: "You want an upbeat shared watch with wit for adults and clarity for younger viewers.",
  maybe_not_if: "You want sharp-edged conflict, adult cynicism, or a demanding dramatic experience tonight.",
};

const createMemoryStore = (rows = new Map()) => ({
  rows,
  async get({ movieId, version }) {
    return rows.get(`${movieId}:${version}`) || null;
  },
  async set({ movieId, version, contextHash, take, model }) {
    rows.set(`${movieId}:${version}`, { context_hash: contextHash, take, model });
  },
});

const run = async () => {
  assert.deepEqual(validateReelbotTake(validTake), validTake);
  assert.equal(validateReelbotTake({ ...validTake, extra: "no" }), null);
  assert.equal(validateReelbotTake({ ...validTake, assessment: "Too short." }), null);
  assert.equal(validateReelbotTake({ ...validTake, good_fit_if: "**Markdown is not allowed here at all.**" }), null);

  let generations = 0;
  const store = createMemoryStore();
  const service = createReelbotTakeService({
    generateTake: async () => {
      generations += 1;
      return validTake;
    },
    persistentStore: store,
    model: "configured-test-model",
  });

  const miss = await service.getTake(movie);
  assert.equal(miss.source, "generated");
  assert.equal(generations, 1);
  const memoryHit = await service.getTake(movie);
  assert.equal(memoryHit.source, "memory_cache");
  assert.equal(generations, 1);

  let concurrentGenerations = 0;
  const concurrentService = createReelbotTakeService({
    generateTake: async () => {
      concurrentGenerations += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return validTake;
    },
  });
  await Promise.all([concurrentService.getTake(movie), concurrentService.getTake(movie)]);
  assert.equal(concurrentGenerations, 1);

  const persistentHitService = createReelbotTakeService({
    generateTake: async () => {
      throw new Error("persistent hit should avoid generation");
    },
    persistentStore: store,
    model: "configured-test-model",
  });
  assert.equal((await persistentHitService.getTake(movie)).source, "persistent_cache");

  const failure = await createReelbotTakeService({
    generateTake: async () => { throw new Error("provider unavailable"); },
  }).getTake(movie);
  assert.equal(failure.source, "fallback");
  assert.match(failure.take.assessment, /temporarily unavailable/i);

  const malformed = await createReelbotTakeService({
    generateTake: async () => ({ assessment: "Generic." }),
  }).getTake(movie);
  assert.equal(malformed.source, "fallback");

  let versionGenerations = 0;
  const oldRows = createMemoryStore(new Map([
    [`${movie.id}:v1`, { context_hash: "old", take: validTake, model: "old" }],
  ]));
  const versioned = createReelbotTakeService({
    version: REELBOT_TAKE_VERSION,
    persistentStore: oldRows,
    generateTake: async () => {
      versionGenerations += 1;
      return validTake;
    },
  });
  assert.equal((await versioned.getTake(movie)).source, "generated");
  assert.equal(versionGenerations, 1);

  assert.doesNotMatch(validTake.assessment, /momentum|set pieces|sustained tension/i);
  console.log("ReelBot Take tests passed");
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
