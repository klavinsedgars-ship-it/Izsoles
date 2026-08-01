# Auction Tracker

Daily tracker for Latvian real-estate listings that emails you new matches based
on criteria you set (city/region, price, area, rooms, keywords, source).

Sources:
- **izsoles.ta.gov.lv** — official electronic auctions (implemented first)
- **City24.lv** — real-estate portal (via its JSON API)
- **SS.com** — classifieds (static HTML)

## How it works

```
scrapers/*  ──►  jobs/runScrape  ──►  Postgres (listings, dedup)
                                          │
                                 core/match (your saved-search criteria)
                                          │
                                 notifications (pending)  ──►  jobs/sendDigests  ──►  Resend email
```

A built-in scheduler (`node-cron`) runs the whole pipeline once a day. You manage
saved searches and browse collected listings from the web UI at `/`.

## Setup

```bash
cd auction-tracker
npm install
cp .env.example .env      # fill in DATABASE_URL, RESEND_API_KEY, EMAIL_FROM
npm run db:push           # create tables
npm run dev               # http://localhost:5000
```

### Environment

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Postgres connection string (provisioned automatically on Replit) |
| `RESEND_API_KEY` | Resend API key. If unset, digests are logged instead of sent — the pipeline still runs. |
| `EMAIL_FROM` | Verified Resend sender, e.g. `Auction Tracker <alerts@yourdomain.com>` |
| `SCRAPE_CRON` | Cron for the daily run (default `0 8 * * *`) |
| `SCHEDULER_ENABLED` | `false` to disable the in-process scheduler |
| `MAX_LISTINGS_PER_SOURCE` | Safety cap per source per run (default 200) |

## Manual commands

```bash
npm run scrape                    # scrape all sources now
npm run scrape -- --source izsoles
npm run digest                    # send pending digests now
tsx src/cli.ts pipeline           # scrape all + digest (what the scheduler runs)
npm test                          # unit tests for the matching logic
```

## Important: scraping & networking

The scrapers must run in an environment with **open outbound internet**. Cloud
sandboxes (including the one this repo was built in) often block or the target
sites (Cloudflare) reject datacenter IPs, so scrapers can only be *live-tuned*
once deployed.

- **izsoles** uses a headless Chromium browser (Playwright) and intercepts the
  site's own JSON API. Run once with `IZSOLES_DEBUG=1` to dump discovered
  payloads to `./debug/izsoles-sample.json` and finalise the field mapping in
  `src/scrapers/izsoles.ts` (`mapRecord`).
- **City24** field names/query params: verify against the live API and adjust
  `src/scrapers/city24.ts` (`buildUrl`, `mapRealty`).
- **SS.com** column order per category: verify and adjust
  `src/scrapers/ss.ts` (`parseFeed`).

The matching, dedup, email, scheduling and UI are fully functional and testable
without network access; only the three site-specific extractors need live tuning.

## Deploying on Replit

1. Provision Postgres (sets `DATABASE_URL`).
2. Add `RESEND_API_KEY` and `EMAIL_FROM` as secrets.
3. `npm run build` then `npm start`, or use a Scheduled Deployment running
   `tsx src/cli.ts pipeline` for the daily job and a separate always-on service
   for the UI.
