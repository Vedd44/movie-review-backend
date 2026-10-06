// Bounds novel catalog reads across all callers, including distributed crawlers.
// Cached pages and simultaneous reads of the same page do not spend this budget.
// Public metadata has its own capacity for a full ~4,000-page sitemap crawl;
// interactive detail reads retain the smaller budget and concurrency protection.
function createCatalogProtection({ now = Date.now, maxEntries = 12000, ttl = 6 * 3600000,
  metadataPerHour = 6000, detailPerHour = 1200, burst = 60, metadataBurst = 6000, maxPending = 20, metadataReserved = 4 } = {}) {
  const cache = new Map();
  const pending = new Map();
  const buckets = new Map();
  function reserve(kind) {
    const time = now();
    const rate = (kind === 'metadata' ? metadataPerHour : detailPerHour) / 3600000;
    const capacity = kind === 'metadata' ? metadataBurst : burst;
    const bucket = buckets.get(kind) || { tokens: capacity, updated: time };
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, time - bucket.updated) * rate);
    bucket.updated = time;
    buckets.set(kind, bucket);
    const detailPending = [...pending.keys()].filter(key => key.startsWith('detail:')).length;
    if (bucket.tokens < 1 || pending.size >= maxPending || (kind === 'detail' && detailPending >= maxPending - metadataReserved)) return Math.max(1, Math.ceil((1 - bucket.tokens) / rate / 1000));
    bucket.tokens -= 1;
    return 0;
  }
  function send(res, value) {
    res.set('Cache-Control', value.status === 200
      ? 'public, max-age=0, s-maxage=21600, stale-while-revalidate=3600'
      : 'public, max-age=0, s-maxage=300');
    res.set('X-ReelBot-Catalog-Cache', 'HIT');
    return res.status(value.status).json(value.body);
  }
  return async function catalogProtection(req, res, next) {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    if (!/^\/(?:movies\/(?:resolve\/[^/]+|\d+)|people\/resolve\/[^/]+|person\/\d+)$/.test(req.path)) return next();
    const kind = req.query.view === 'metadata' ? 'metadata' : 'detail';
    const key = `${kind}:${req.path}`;
    const value = cache.get(key);
    if (value && value.expires > now()) return send(res, value);
    cache.delete(key);
    if (pending.has(key)) {
      const result = await pending.get(key);
      if (result) return send(res, result);
      // Do not start another lookup when the first upstream attempt failed.
      return res.status(503).set('Cache-Control', 'no-store').set('Retry-After', '60').json({error:'Movie details temporarily unavailable'});
    }
    const retry = reserve(kind);
    if (retry) return res.status(429).set('Cache-Control', 'no-store').set('Retry-After', String(retry)).json({error:'Please try again shortly'});
    let settle;
    const operation = new Promise(resolve => { settle = resolve; });
    pending.set(key, operation);
    const originalJson = res.json;
    res.json = function(body) {
      let result = null;
      if ([200,404].includes(res.statusCode)) {
        result = { status: res.statusCode, body, expires: now() + (res.statusCode === 404 ? 300000 : ttl) };
        cache.set(key, result);
        // Populate both sides of the canonical redirect in one lookup. Crawlers
        // must not spend another token or search request following that redirect.
        if (kind === 'metadata' && res.statusCode === 200 && body?.id && body?.canonical_slug) {
          const aliases = req.path.startsWith('/movies/')
            ? [`/movies/${body.id}`, `/movies/resolve/${body.canonical_slug}`]
            : [`/person/${body.id}`, `/people/resolve/${body.canonical_slug}`];
          for (const alias of aliases) cache.set(`metadata:${alias}`, result);
        }
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
        res.set('Cache-Control', res.statusCode === 200
          ? 'public, max-age=0, s-maxage=21600, stale-while-revalidate=3600'
          : 'public, max-age=0, s-maxage=300');
      }
      pending.delete(key); settle(result);
      res.set('X-ReelBot-Catalog-Cache', 'MISS');
      return originalJson.call(this, body);
    };
    res.once('close', () => { if (pending.get(key) === operation) { pending.delete(key); settle(null); } });
    next();
  };
}
module.exports = {createCatalogProtection};
