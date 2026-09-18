const assert = require("node:assert/strict");
const { resolveProgressiveSourcePage } = require("../src/discovery/feedPagination");

assert.equal(resolveProgressiveSourcePage({ requestedPage: 1, firstSourcePage: 2 }), 2);
assert.equal(resolveProgressiveSourcePage({ requestedPage: 2, firstSourcePage: 2 }), 3);
assert.notEqual(
  resolveProgressiveSourcePage({ requestedPage: 1, firstSourcePage: 2 }),
  resolveProgressiveSourcePage({ requestedPage: 2, firstSourcePage: 2 })
);
assert.equal(resolveProgressiveSourcePage({ requestedPage: 3, firstSourcePage: 4 }), 6);

console.log("Discovery pagination checks passed.");
