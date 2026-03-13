const assert = require('assert');

const API_BASE = process.env.REELBOT_TEST_API || 'http://127.0.0.1:5052';

const cases = [
  { prompt: 'Keanu Reeves', expectedType: 'PERSON', expectedKind: 'actor' },
  { prompt: 'Christopher Nolan', expectedType: 'DIRECTOR', expectedKind: 'director' },
  { prompt: 'Florence Pugh', expectedType: 'PERSON', expectedKind: 'actor' },
  { prompt: 'movies like Interstellar', expectedType: 'TITLE_SIMILARITY', expectedKind: 'movie_title' },
  { prompt: 'John Wick', expectedType: 'FRANCHISE', expectedKind: 'franchise' },
];

const postPick = async (body) => {
  const response = await fetch(`${API_BASE}/reelbot/pick`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ReelBot-Trigger': 'user_click',
    },
    body: JSON.stringify({ trigger: 'user_click', ...body }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(json)}`);
  }
  return json;
};

(async () => {
  for (const testCase of cases) {
    const first = await postPick({
      prompt: testCase.prompt,
      source: 'library',
      view: 'popular',
      mood: 'all',
      runtime: 'any',
      company: 'any',
      genre: 'all',
      refresh_key: `entity-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    });

    assert.strictEqual(first.resolved_intent.query_type, testCase.expectedType, `${testCase.prompt} query_type mismatch`);
    assert.strictEqual(first.resolved_intent.entity_anchor?.kind, testCase.expectedKind, `${testCase.prompt} entity kind mismatch`);
    assert.strictEqual(first.validation?.primary_valid, true, `${testCase.prompt} primary should validate`);
    assert.strictEqual(first.validation?.alternates_valid, true, `${testCase.prompt} alternates should validate`);
    assert(first.primary?.id, `${testCase.prompt} should return a primary`);
    assert(Array.isArray(first.candidate_pool_ids) && first.candidate_pool_ids.length > 0, `${testCase.prompt} should preserve candidate_pool_ids`);

    const excludedIds = [first.primary?.id, ...((first.alternates || []).map((movie) => movie?.id))].filter(Boolean);
    const swap = await postPick({
      prompt: testCase.prompt,
      source: 'library',
      view: 'popular',
      mood: 'all',
      runtime: 'any',
      company: 'any',
      genre: 'all',
      excluded_ids: excludedIds,
      intent_snapshot: first.resolved_intent,
      candidate_pool_ids: first.candidate_pool_ids,
      refresh_key: `swap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    });

    assert.strictEqual(swap.resolved_intent.query_type, testCase.expectedType, `${testCase.prompt} swap query_type mismatch`);
    assert.strictEqual(swap.validation?.primary_valid, true, `${testCase.prompt} swap primary should validate`);
    assert.strictEqual(swap.validation?.alternates_valid, true, `${testCase.prompt} swap alternates should validate`);
    assert(swap.primary?.id && swap.primary.id !== first.primary.id, `${testCase.prompt} swap should produce a different valid primary`);
  }

  console.log(`Entity guardrail checks passed for ${cases.length} prompts against ${API_BASE}.`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
