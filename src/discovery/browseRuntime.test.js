const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyBrowseRuntimes, matchesBrowseRuntime } = require("./browseRuntime");

test("under two hours means verified positive runtime strictly below 120", () => {
  for (const runtime of [null, undefined, 0, -1, "unknown", 120, 137, 166]) {
    assert.equal(matchesBrowseRuntime(runtime, "under_two_hours"), false);
  }
  assert.equal(matchesBrowseRuntime(119, "under_two_hours"), true);
  assert.equal(matchesBrowseRuntime(120, "over_two_hours"), true);
  assert.equal(matchesBrowseRuntime(119, "over_two_hours"), false);
});

test("verifies details, excludes unknown/too-long results, preserves order and metadata", async () => {
  const movies = [1, 2, 3, 4, 5, 6].map(id => ({ id, title: `Film ${id}`, runtime: 90, source_type: "discover" }));
  const result = await verifyBrowseRuntimes(movies, "under_two_hours", async id => {
    if (id === 5) return { runtime: null };
    return { runtime: ({ 1: 119, 2: 137, 3: 166, 4: null, 6: 95 })[id] };
  });
  assert.deepEqual(result.map(movie => movie.id), [1, 6]);
  assert.equal(result[0].runtime, 119);
  assert.equal(result[0].source_type, "discover");
});

test("no runtime filter adds no detail calls or changes", async () => {
  const movies = [{ id: 1 }];
  assert.equal(await verifyBrowseRuntimes(movies, "any", () => { throw Error("must not call"); }), movies);
});

test("detail verification concurrency is bounded to five", async () => {
  let active = 0, peak = 0;
  const movies = Array.from({ length: 30 }, (_, i) => ({ id: i + 1 }));
  const result = await verifyBrowseRuntimes(movies, "under_two_hours", async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return { runtime: 100 };
  });
  assert.equal(peak, 5);
  assert.equal(result.length, 30);
});

test("initial fill stops once enough verified movies exist, without unbounded lookahead", async () => {
  let calls = 0;
  const movies = Array.from({ length: 40 }, (_, i) => ({ id: i + 1 }));
  const result = await verifyBrowseRuntimes(movies, "under_two_hours", async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 1));
    return { runtime: 100 };
  }, 10);
  assert.equal(result.length, 10);
  assert.ok(calls <= 14, `Expected <=14 detail calls, got ${calls}`);
});

test("rate limited detail lookups fail closed without retrying or relaxing runtime", async () => {
  let calls = 0;
  await assert.rejects(verifyBrowseRuntimes([{ id: 1 }, { id: 2 }], "under_two_hours", async () => {
    calls++;
    const error = new Error("Too many requests"); error.response = { status: 429 };
    throw error;
  }), { code: "BROWSE_RUNTIME_UNAVAILABLE" });
  assert.equal(calls, 2);
});


test("a stalled lookup releases Browse by the deadline and schedules no more work", async () => {
  let calls = 0;
  const started = Date.now();
  await assert.rejects(verifyBrowseRuntimes(Array.from({length:40}, (_,i) => ({id:i+1})), "under_two_hours", () => {
    calls++;
    return new Promise(() => {});
  }, 10, {timeoutMs:30}), {code:"BROWSE_RUNTIME_UNAVAILABLE"});
  assert.equal(calls, 5);
  assert.ok(Date.now() - started < 1000);
});
