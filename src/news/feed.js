const { createHash } = require('node:crypto');
const { XMLParser } = require('fast-xml-parser');
const SOURCES = Object.freeze([
  { id: 'variety', name: 'Variety', url: 'https://variety.com/v/film/feed/', host: 'variety.com' },
  { id: 'deadline', name: 'Deadline', url: 'https://deadline.com/v/film/feed/', host: 'deadline.com' },
  { id: 'thr', name: 'The Hollywood Reporter', url: 'https://www.hollywoodreporter.com/c/movies/movie-news/feed/', host: 'www.hollywoodreporter.com' },
  { id: 'indiewire', name: 'IndieWire', url: 'https://www.indiewire.com/feed/', host: 'www.indiewire.com' },
]);
const parser = new XMLParser({ ignoreAttributes: true, processEntities: false, trimValues: false, parseTagValue: false });
function plain(value) {
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => { const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''; }).replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[n])).trim();
}
function canonical(value, host) {
  try { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password || u.hostname.replace(/^www\./, '') !== host.replace(/^www\./, '')) return null; u.hash = ''; [...u.searchParams.keys()].filter(k => /^(utm_|ref$|source$)/i.test(k)).forEach(k => u.searchParams.delete(k)); return u.href; } catch { return null; }
}
const hasSpoilerWarning = story => /spoiler\s*(alert|warning)|contains (major )?spoilers/i.test((story?.headline || '') + ' ' + (story?.summary || ''));
function parseFeed(xml, source, now = Date.now()) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('invalid_feed');
  const channel = parser.parse(xml)?.rss?.channel;
  if (!channel) throw new Error('invalid_feed');
  const raw = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
  return raw.slice(0, 100).flatMap(item => {
    const headline = plain(item.title); const summary = plain(item.description); const sourceUrl = canonical(plain(item.link), source.host); const at = Date.parse(plain(item.pubDate));
    if (hasSpoilerWarning({headline,summary})) return [];
    if (!headline || headline.length > 1000 || !summary || summary.length > 16000 || !sourceUrl || !Number.isFinite(at) || at > now + 60000 || now - at > 7 * 86400000) return [];
    if (/\b(HBO|Netflix|Apple TV\+?|television)\s+series\b|\bTV series\b/i.test(headline) && !/\b(film|movie|cinema)\b/i.test(headline)) return [];
    const categories = (Array.isArray(item.category) ? item.category : [item.category]).map(plain).join(' ').toLowerCase();
    if (source.id === 'indiewire' && !/\/film\/|\/movies\//i.test(sourceUrl) && !/\b(film|films|movies|cinema|box office)\b/.test(categories)) return [];
    return [{ id: createHash('sha256').update(sourceUrl).digest('hex').slice(0, 32), headline, summary, sourceName: source.name, sourceId: source.id, sourceUrl, publishedAt: new Date(at).toISOString(), author: plain(item['dc:creator'] || item.author).slice(0, 240) }];
  });
}
const words = value => new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !['with','from','that','this','first','movie','film','after','news','says','the','and','for','new','all','its','her','his','was','are','but','exclusive','works','writer','tapped','pen'].includes(w)));
function sameStory(a, b) {
  if (a.sourceUrl === b.sourceUrl || a.id === b.id) return true;
  if (Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt)) > 48 * 3600000) return false;
  const x = words(a.headline), y = words(b.headline); const intersection = [...x].filter(w => y.has(w)).length;
  return intersection >= 3 && intersection / Math.min(x.size, y.size) >= 0.65;
}
function selectStories(stories, limit = 25) {
  const selected = [];
  for (const story of [...stories].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))) {
    if (!selected.some(old => sameStory(old, story))) selected.push(story);
    if (selected.length === limit) break;
  }
  return selected;
}
module.exports = { hasSpoilerWarning, SOURCES, parseFeed, plain, canonical, sameStory, selectStories };
