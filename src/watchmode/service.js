const DAY = 86400000;
const CACHE_TTL = 7 * DAY;
const GROUPS = {sub:'subscription',rent:'rent',buy:'buy',free:'free',tve:'cable'};
function safeWebUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.href;
  } catch { return ''; }
}
function normalizeSources(sources, checkedAt) {
  if (!Array.isArray(sources)) throw Error('Invalid Watchmode response');
  const availability = {source:'watchmode',region:'US',checked_at:new Date(checkedAt).toISOString(),subscription:[],rent:[],buy:[],free:[],cable:[]};
  for (const item of sources) {
    const group = GROUPS[item?.type];
    const url = safeWebUrl(item?.web_url);
    const id = Number(item?.source_id);
    if (item?.region !== 'US' || !group || !url || !Number.isSafeInteger(id) || id <= 0 || !item.name) continue;
    const list = availability[group];
    const existing = list.find(provider => provider.id === id);
    const price = item.price != null && Number.isFinite(Number(item.price)) && Number(item.price) >= 0 ? Number(item.price) : null;
    const provider = {id,name:String(item.name).slice(0,120),access_type:group,direct_url:url,direct_link_source:'watchmode',price};
    if (!existing) list.push(provider);
    else if (price != null && (existing.price == null || price < existing.price)) Object.assign(existing,provider);
  }
  // Do not erase the TMDB fallback if the response only contains unusable links.
  if (sources.length && !Object.keys(GROUPS).some(type => availability[GROUPS[type]].length)) return null;
  return availability;
}
function createWatchmodeService({apiKey, httpClient, store, now = Date.now, dailyCredits = 100, monthlyCredits = 2000, log = console.log}) {
  const enabled = Boolean(apiKey && store?.enabled);
  const cache = new Map(), pending = new Map();
  let queue = Promise.resolve(), blockedUntil = 0;
  const config = {headers:{'X-API-Key':apiKey},timeout:5000,maxRedirects:0};
  function remember(id, value, expires) {
    cache.set(id,{value,expires});
    while (cache.size > 1500) cache.delete(cache.keys().next().value);
    return value;
  }
  async function lookup(id) {
    const path = `movie-${id}-US.json`;
    try {
      const stored = await store.get(path);
      if (stored?.v === 1 && stored.movie_id === id && Number.isFinite(stored.fetched_at) && stored.fetched_at <= now() && now() - stored.fetched_at < CACHE_TTL) {
        return remember(id, stored.availability, stored.fetched_at + CACHE_TTL);
      }
      if (now() < blockedUntil) return remember(id,null,Math.min(blockedUntil,now()+300000));
      const day = new Date(now()).toISOString().slice(0,10);
      const ledger = await store.get('budget.json');
      const spent = ledger?.day === day ? Number(ledger.credits) : 0;
      if (!Number.isFinite(spent) || spent < 0) throw Error('Invalid Watchmode budget');
      if (spent + 2 > dailyCredits) {
        log(`Watchmode fallback: daily credit guard (${spent}/${dailyCredits})`);
        return remember(id,null,now()+300000);
      }
      // Status is free and authoritative across restarts and billing renewals.
      // Serialize novel reads on our single Render instance; reserve in durable
      // storage before a paid call, including timeouts/failures, to stop storms.
      const status = (await httpClient.get('https://api.watchmode.com/v1/status/',config)).data;
      const quota = Number(status?.quota), used = Number(status?.quotaUsed);
      if (!Number.isFinite(quota) || !Number.isFinite(used) || quota < 0 || used < 0) throw Error('Invalid Watchmode quota');
      const limit = Math.min(monthlyCredits, Math.max(0, quota - 100));
      if (used + 2 > limit) {
        log(`Watchmode fallback: monthly credit guard (${used}/${limit})`);
        return remember(id,null,now()+300000);
      }
      await store.set('budget.json',{v:1,day,credits:spent+2});
      const response = await httpClient.get(`https://api.watchmode.com/v1/title/movie-${id}/sources/`,{...config,params:{regions:'US'}});
      const fetchedAt = now();
      const availability = normalizeSources(response.data, fetchedAt);
      await store.set(path,{v:1,movie_id:id,fetched_at:fetchedAt,availability});
      log(`Watchmode sources: tmdb=${id} region=US daily=${spent+2}/${dailyCredits} account_used=${used+2}/${limit}`);
      return remember(id,availability,fetchedAt+CACHE_TTL);
    } catch (error) {
      // Never log Axios error/config/message: the private key is in its headers.
      const status = Number(error.response?.status) || 0;
      log(`Watchmode fallback: tmdb=${id} upstream_status=${status}`);
      blockedUntil = now() + (status === 401 || status === 403 ? 3600000 : 60000);
      return remember(id,null,now()+(status===404?DAY:300000));
    }
  }
  return {
    enabled,
    async get(movieId) {
      const id = Number(movieId);
      if (!enabled || !Number.isSafeInteger(id) || id <= 0 || id > 2147483647) return null;
      const known = cache.get(id);
      if (known?.expires > now()) return known.value;
      if (pending.has(id)) return pending.get(id);
      if (pending.size >= 6) return null;
      // Rejected operations do not poison the queue.
      const operation = queue.then(() => lookup(id));
      queue = operation.catch(() => {});
      pending.set(id,operation);
      try { return await operation; } finally { pending.delete(id); }
    },
  };
}
module.exports = {createWatchmodeService,normalizeSources,safeWebUrl,CACHE_TTL};
