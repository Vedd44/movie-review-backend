function createNewsStore({ baseUrl, serviceKey, httpClient }) {
  if (!baseUrl || !serviceKey) return null;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const root = baseUrl.replace(/\/$/, '') + '/rest/v1';
  async function rpc(name, args) { const result = await httpClient.post(`${root}/rpc/${name}`, args, { headers, timeout: 10000 }); return result.data; }
  return {
    async read() { const r = await httpClient.get(`${root}/reelbot_news_state`, { headers, params: { id: 'eq.1', select: 'snapshot', limit: 1 }, timeout: 8000 }); return r.data?.[0]?.snapshot || null; },
    claim: token => rpc('reelbot_news_claim', { p_token: token }),
    reserve: (token, storyKey) => rpc('reelbot_news_reserve', { p_token: token, p_story_key: storyKey }),
    settle: (token, reservation, cost, take) => rpc('reelbot_news_settle', { p_token: token, p_reservation: reservation, p_cost: cost, p_take: take || null }),
    finish: (token, snapshot) => rpc('reelbot_news_finish', { p_token: token, p_snapshot: snapshot }),
  };
}
module.exports = { createNewsStore };
