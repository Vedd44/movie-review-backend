const assert = require("node:assert/strict");
const express = require("express");
const axios = require("axios");
let server;
let failureMode = false;
const listen = express.application.listen;
express.application.listen = function () { server = listen.call(this, 0); return server; };
const detailCalls = [];
const fixtures = [
  { id: 24, title: "Kill Bill Vol. 2", runtime: 137 },
  { id: 693134, title: "Dune: Part Two", runtime: 166 },
  { id: 3, title: "At the boundary", runtime: 120 },
  { id: 4, title: "Just under", runtime: 119 },
  { id: 5, title: "Unknown runtime", runtime: null },
  { id: 6, title: "Unavailable details", runtime: 90 },
];
axios.get = async (url) => {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith("/discover/movie") || parsed.pathname.endsWith("/trending/movie/week")) {
    return { data: { results: fixtures.map(({runtime, ...movie}) => ({ ...movie, poster_path: "/fixture.jpg", popularity: 100, vote_count: 2000, vote_average: 7, release_date: "2020-01-01", genre_ids: [28] })), total_pages: 4, total_results: 24 } };
  }
  const id = Number(parsed.pathname.split("/").pop());
  detailCalls.push(id);
  if (id === 100) return new Promise(() => {});
  if (failureMode || id === 6) {
    if (failureMode) { const error = new Error("rate limited"); error.response = {status:429}; throw error; }
    return {data:{runtime:null}};
  }
  const movie = fixtures.find(movie => movie.id === id);
  if (movie) return { data: movie };
  throw Error(`Unexpected upstream request ${parsed.pathname}`);
};
require("../index");
(async () => {
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const query of [
      "runtime=under_two_hours&page=1&fill=10",
      "runtime=under_two_hours&page=2&fill=10",
      "runtime=under_two_hours&page=3",
      "runtime=under_two_hours&page=1&fill=10&genre=28",
      "runtime=under_two_hours&page=2&fill=10",
    ]) {
      const response = await fetch(`${base}/movies?type=popular&${query}`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.results.map(movie => movie.id), [4], query);
      assert.equal(body.results[0].runtime, 119);
    }
    const long = await (await fetch(`${base}/movies?type=popular&runtime=over_two_hours&page=2&fill=10`)).json();
    assert.deepEqual(new Set(long.results.map(movie => movie.id)), new Set([24, 693134, 3]));
    const callsBefore = detailCalls.length;
    const unfiltered = await (await fetch(`${base}/movies?type=popular&page=2&runtime=any`)).json();
    assert.equal(unfiltered.results.length, 6);
    assert.equal(detailCalls.length, callsBefore, "Unfiltered Browse must not hydrate runtimes");
    assert.equal(detailCalls.filter(id => id === 24).length, 1, "Verified facts use existing cache");
    failureMode = true;
    // Existing successful details are cached: fixture6 is unknown, so use a new ID for an uncached failure.
    fixtures.push({id:99, title:"Rate limited details", runtime:90});
    // A distinct genre keeps this fixture uncached regardless of discovery page rotation.
    const unavailable = await fetch(`${base}/movies?type=popular&runtime=under_two_hours&page=4&fill=10&genre=35`);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("retry-after"), "30");
    const unavailableBody = await unavailable.json();
    assert.ok(!("results" in unavailableBody), "An upstream outage must not appear as an empty successful page");
    failureMode = false;
    fixtures.push({id:100, title:"Stalled details", runtime:90});
    const stalledStart = Date.now();
    const stalled = await fetch(`${base}/movies?type=popular&runtime=under_two_hours&page=5&fill=10&genre=53`);
    assert.equal(stalled.status, 503);
    assert.ok(Date.now() - stalledStart < 6500, "A stalled upstream detail must not hang the Browse response");
    console.log("Browse runtime HTTP checks passed: initial fill, pagination, no-fill, genre, repeated request, 120-minute boundary, unknowns, failures, and unchanged unfiltered path.");
  } finally { server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
