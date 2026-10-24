# Movie news service

This is isolated from recommendation generation. GET `/movie-news` reads the last successful database snapshot and can nudge the background worker once per process per minute. A database lease and persisted UTC six-hour slots (00:00, 06:00, 12:00, 18:00) prevent duplicate refreshes. Startup and a lightweight one-minute timer also check due work. A free Render instance can sleep; an external scheduled wake is needed for unattended refreshes.

Only the four fixed RSS endpoints in `feed.js` are fetched. Redirects, external entities, article scraping and publisher images are disabled. Headline and description wording is preserved after HTML-to-text/entity decoding. A separate AI-generated Take uses only these feed facts, never full articles. Publisher terms remain a user-accepted uncertainty, not a legal clearance claim.

`NEWS_ENABLED=false` disables background refresh without removing the last snapshot. Existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY` are reused server-side. No browser credential is introduced.

The migration in `scripts/sql/reelbot-news.sql` creates news-only tables and invoker RPCs, with RLS and no anonymous/authenticated grants. Apply before deploying the worker. Existing tables and user data are untouched.

The active feed is capped at 25; the home client takes the first three. The prior snapshot supports rollback, and an internal 200-record cache plus durable content-key generation ledger avoids repeated paid generation after items leave the active feed or processes restart. The generation ledger is not publicly exposed. No permanent deletion operation is used.

The user-approved incremental news cap is $5 per UTC calendar month. Each new content hash reserves 1,200 microdollars before calling the model. Calls use fixed `gpt-6-luna`, default service tier, reasoning none, combined system/user bytes <=8,000, and maximum400 completion tokens. Standard pricing verified 2026-10-24 is $0.10/M input tokens and $0.50/M output tokens: https://developers.openai.com/api/docs/models/gpt-6-luna . Successful responses settle measured token usage; ambiguous failures retain the full reservation. No automatic model fallback or paid retry is made. Review pricing before changing models/rates/token limits.

Run `npm run test:movie-news` for fixture service tests and executable PostgreSQL/PGlite checks of lease, reservation/dedupe, cap, settlement and anonymous-access denial. These do not call live providers or spend API budget. The live release must separately verify actual ingestion, generation quality, API status and frontend placement. No claim of physical-device testing is implied.
