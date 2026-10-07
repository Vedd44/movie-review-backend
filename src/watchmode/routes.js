const ALLOWED_ORIGIN = /^https:\/\/(?:reelbot\.movie|movie-review-frontend[^/]*\.vercel\.app)$/;
function installWatchmodeRoutes(app, {service, movieExists, now=Date.now}) {
  const recent = new Map();
  app.post('/movies/:id/watch-availability', async (req,res) => {
    res.set('Cache-Control','no-store');
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) <= 0 || Number(req.params.id) > 2147483647) return res.status(400).json({error:'Invalid movie'});
    const origin = String(req.headers.origin || '');
    if (!ALLOWED_ORIGIN.test(origin) && !(process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin))) return res.status(403).json({error:'Origin not allowed'});
    if (/bot|crawler|spider|headless/i.test(String(req.headers['user-agent'] || ''))) return res.json({availability:null});
    if (!service.enabled) return res.json({availability:null});
    const ip = String(req.headers['x-forwarded-for'] || req.ip).split(',')[0].trim();
    const entry = recent.get(ip);
    const value = entry && now()-entry.time < 60000 ? entry : {time:now(),count:0};
    if (value.count >= 15) return res.status(429).json({availability:null});
    value.count++; recent.set(ip,value);
    if (recent.size > 2000) recent.delete(recent.keys().next().value);
    try {
      const id = Number(req.params.id);
      if (!await movieExists(id)) return res.status(404).json({availability:null});
      return res.json({availability:await service.get(id)});
    } catch { return res.json({availability:null}); }
  });
}
module.exports = {installWatchmodeRoutes};
