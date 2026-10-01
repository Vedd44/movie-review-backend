const test = require('node:test');
const assert = require('node:assert/strict');
const { timingMiddleware, measureStage, finishTiming } = require('../ai/requestTiming');
test('concurrent requests retain only their own stages, including failures', async () => {
  const run = (name, fail) => new Promise((resolve) => timingMiddleware({}, {}, async () => {
    await measureStage(name, async () => { await new Promise(r => setTimeout(r, 4)); if (fail) throw Error('upstream'); }).catch(() => {});
    resolve(finishTiming({set: () => {}}, fail ? 'fallback' : 'pick'));
  }));
  const [a, b] = await Promise.all([run('metadata', false), run('ranking', true)]);
  assert.deepEqual(Object.keys(a.stages), ['metadata']);
  assert.deepEqual(Object.keys(b.stages), ['ranking']);
  assert.equal(b.outcome, 'fallback');
  assert.ok(a.total_ms >= a.stages.metadata);
});
