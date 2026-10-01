const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');
const timing = new AsyncLocalStorage();

// Request-local spans. Concurrent upstream work must not leak across requests.
const timingMiddleware = (req, res, next) => timing.run({ started: performance.now(), stages: {} }, next);
const measureStage = async (name, operation) => {
  const trace = timing.getStore();
  const start = performance.now();
  try { return await operation(); }
  finally { if (trace) trace.stages[name] = (trace.stages[name] || 0) + performance.now() - start; }
};
const markRecovery = () => { const trace = timing.getStore(); if (trace) trace.recovered = true; };
const finishTiming = (res, outcome, cached = false) => {
  const trace = timing.getStore();
  if (!trace) return null;
  const stages = Object.fromEntries(Object.entries(trace.stages).map(([name, ms]) => [name, Math.round(ms)]));
  if (outcome === "pick" && trace.recovered) outcome = "fallback";
  const result = { total_ms: Math.round(performance.now() - trace.started), stages, outcome, cached };
  res.set('Server-Timing', [`reelbot;dur=${result.total_ms}`, ...Object.entries(stages).map(([name, ms]) => `${name};dur=${ms}`)].join(', '));
  console.log(JSON.stringify({ type: 'recommendation_performance', ...result }));
  return result;
};
module.exports = { timingMiddleware, measureStage, finishTiming, markRecovery };
