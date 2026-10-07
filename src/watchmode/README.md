Watchmode trial
==============

Set WATCHMODE_API_KEY on the Render backend only. Existing SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY create/use the private reelbot-watchmode-cache bucket.
No SQL migration, frontend key, paid plan, or affiliate configuration is needed.

POST /movies/:id/watch-availability is called when the movie's Where to Watch
section enters the viewport. It is separate from movie metadata, detail JSON,
recommendation generation, grid badges and sitemap crawling. Known crawler user
agents and unrelated origins are rejected. The Origin check is not authentication;
the durable daily limit and provider quota guard bound spending even if spoofed.

U.S. results are cached for 7 days across deployments. Old files are removed on
startup and daily after 28 days; cache failures stop novel paid lookups. Deleting
or terminating the Watchmode account also requires deleting this private bucket.
Provider IDs are Watchmode IDs, not TMDB provider IDs. Logos are reused only for
exact TMDB provider-name matches in the same region. Free and cable offers are
separate groups; subscription/channel brands are never fuzzy-matched.

Every novel lookup checks the zero-credit /status endpoint. TMDB IDs cost 2
credits per sources lookup. The trial allows at most 100 reserved credits per
UTC day and stops at 2,000 account credits in Watchmode's current quota cycle
(or quota minus 100 if the account allowance is lower). Failed attempts also
reserve daily credits. The daily ledger and paid-read queue assume the current
single Render instance; add a distributed atomic reservation before scaling.
Concurrent reads of one title share a request. Errors and quota limits fall back
to the original TMDB availability. Cached valid results remain usable at limits.

The frontend attributes Watchmode on every section showing its data and retains
the TMDB viewing-options link. Consent-controlled watch_options_viewed,
provider_clicked and viewing_options_clicked events feed GA4/Vercel and private
admin metrics. Provider clicks retain movie, provider, access type and source,
never the destination URL. Admin metrics follow the existing 7-day sample and
exclude-my-activity settings; clicks do not prove playback.

Validation:
  node --test src/watchmode/*.test.js
  node --check index.js
