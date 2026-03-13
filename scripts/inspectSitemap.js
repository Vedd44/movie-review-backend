const REQUIRED_PATHS = [
  '/',
  '/browse',
  '/now-playing',
  '/trending',
  '/coming-soon',
];

const DEFAULT_SITEMAP_URL = process.env.SITEMAP_URL || 'http://127.0.0.1:5052/sitemap.xml';
const EXPECTED_HOST = (process.env.SITEMAP_EXPECTED_HOST || 'reelbot.movie').replace(/^https?:\/\//, '').replace(/\/$/, '');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    url: DEFAULT_SITEMAP_URL,
    expectedHost: EXPECTED_HOST,
  };

  args.forEach((arg) => {
    if (arg.startsWith('--url=')) {
      options.url = arg.slice('--url='.length);
    } else if (arg.startsWith('--host=')) {
      options.expectedHost = arg.slice('--host='.length).replace(/^https?:\/\//, '').replace(/\/$/, '');
    }
  });

  return options;
};

const extractMatches = (pattern, source) => Array.from(source.matchAll(pattern), (match) => match[1]);

const toPath = (urlValue) => {
  try {
    const parsed = new URL(urlValue);
    return parsed.pathname;
  } catch (error) {
    return '';
  }
};

const main = async () => {
  const { url, expectedHost } = parseArgs();
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const locs = extractMatches(/<loc>([^<]+)<\/loc>/g, xml);
  const lastmods = extractMatches(/<lastmod>([^<]+)<\/lastmod>/g, xml);

  const urls = locs.map((loc) => {
    const parsed = new URL(loc);
    return {
      loc,
      host: parsed.host,
      path: parsed.pathname,
      isMovie: /^\/movies\//.test(parsed.pathname),
    };
  });

  const staticPaths = new Set(urls.filter((entry) => !entry.isMovie).map((entry) => entry.path));
  const movieUrls = urls.filter((entry) => entry.isMovie);
  const missingPaths = REQUIRED_PATHS.filter((path) => !staticPaths.has(path));
  const wrongHostEntries = urls.filter((entry) => entry.host !== expectedHost);

  console.log(JSON.stringify({
    sitemap_url: url,
    expected_host: expectedHost,
    total_urls: urls.length,
    static_url_count: urls.length - movieUrls.length,
    movie_url_count: movieUrls.length,
    has_required_static_paths: missingPaths.length === 0,
    missing_static_paths: missingPaths,
    wrong_host_count: wrongHostEntries.length,
    sample_movie_urls: movieUrls.slice(0, 5).map((entry) => entry.loc),
    latest_lastmods: lastmods.slice(0, 5),
  }, null, 2));

  if (missingPaths.length || wrongHostEntries.length || !movieUrls.length) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
