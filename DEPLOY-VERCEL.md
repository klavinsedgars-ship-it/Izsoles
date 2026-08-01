# Deploying on Vercel (+ Neon + GitHub Actions)

This app splits into three free pieces:

| Piece | Runs on | Job |
|-------|---------|-----|
| Web UI + API | **Vercel** | Manage saved searches, browse listings & history |
| Database | **Neon** (Postgres) | Shared storage for both sides |
| Daily scrape + email worker | **GitHub Actions** | Scrape izsoles/City24/SS, send digests |

Why the worker is on GitHub Actions and not Vercel: the izsoles scraper drives a
real headless browser and can run for minutes — that doesn't fit Vercel's
serverless function limits. GitHub Actions gives a full Ubuntu machine with a
browser, free, once a day.

---

## Step 1 — Create the database (Neon)

1. Go to <https://neon.tech> → sign up → **Create project** (pick the EU region,
   e.g. Frankfurt, closest to Latvia).
2. On the project dashboard, copy the **pooled** connection string (the one whose
   host contains `-pooler`). It looks like:
   `postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`
3. Keep this handy — it's your `DATABASE_URL`.

## Step 2 — Create the tables

From your machine, once:

```bash
cd auction-tracker
npm install
DATABASE_URL="<your Neon pooled URL>" npm run db:push
```

(Or run it later from GitHub Actions — but doing it once locally confirms the URL works.)

## Step 3 — Get a Resend API key

1. <https://resend.com> → sign up.
2. **API Keys → Create** → copy it (`re_...`). That's `RESEND_API_KEY`.
3. For real sending you must verify a domain (Resend → Domains). Until then you
   can use `EMAIL_FROM="Auction Tracker <onboarding@resend.dev>"`, which only
   delivers to your own Resend account email — fine for testing.

## Step 4 — Deploy the UI + API to Vercel

1. Push this repo to GitHub (see Step 6 if not done).
2. <https://vercel.com> → **Add New… → Project** → import your GitHub repo.
3. **Root Directory:**
   - If this is the **standalone `auction-tracker` repo** → leave it as the
     default (repo root).
   - If the app lives in a **subfolder** of a larger repo → set Root Directory
     to `auction-tracker`.
4. Framework preset: **Other**. Build command / output can stay empty — Vercel
   serves `public/` and builds the `api/` functions automatically.
5. Add **Environment Variables** (Settings → Environment Variables):
   | Name | Value |
   |------|-------|
   | `DATABASE_URL` | your Neon pooled URL |
   | `RESEND_API_KEY` | your Resend key |
   | `EMAIL_FROM` | `Auction Tracker <onboarding@resend.dev>` (or your domain) |
   | `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | `1` (keeps the build fast; the browser isn't used on Vercel) |
6. **Deploy.** When it finishes, open the URL — you should see the Auction
   Tracker UI. Create a saved search to confirm the API + database work.

## Step 5 — Set up the daily worker (GitHub Actions)

The workflow file is already in the repo: `.github/workflows/auction-daily.yml`.
It just needs secrets:

1. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**.
   Add three secrets:
   - `DATABASE_URL` — same Neon pooled URL
   - `RESEND_API_KEY`
   - `EMAIL_FROM`
2. Go to the **Actions** tab → “Daily auction scrape & digest” → **Run workflow**
   to test it immediately (don't wait for 06:00 UTC).
3. Check the run logs: you'll see how many listings each source returned and how
   many digest emails were sent. This is also where you'll do the one-time
   scraper tuning (see below).

## Step 6 — Push the repo to GitHub (if you haven't)

```bash
git add .
git commit -m "Auction tracker"
git push
```

---

## First-run scraper tuning (one time, ~15 min)

The three site extractors were written without live access to the sites (they
block cloud build environments), so the first real run on GitHub Actions is where
you confirm the field mappings:

- **izsoles** — in the Actions run, if it reports `0 records captured`, run the
  workflow once with an `IZSOLES_DEBUG=1` env (add it under the pipeline step)
  to dump the site's JSON to `debug/izsoles-sample.json`, then adjust
  `mapRecord()` in `src/scrapers/izsoles.ts` to the real field names.
- **City24** — verify the API URL/params and field names in
  `src/scrapers/city24.ts` (`buildUrl`, `mapRealty`).
- **SS.com** — verify the per-category column order in `src/scrapers/ss.ts`.

Everything downstream (matching, dedup, email, UI) is already verified working.

## Notes

- **Changing the schedule:** edit the `cron:` line in
  `.github/workflows/auction-daily.yml` (it's in UTC).
- **Manual trigger from the UI:** the "Run scrape now" button on Vercel runs
  City24 + SS.com (izsoles needs the browser worker) and works for quick checks.
- **Alternative (all on Vercel):** you can instead run City24 + SS + digest from a
  Vercel Cron job hitting an API route; izsoles still needs the Actions worker.
  The GitHub Actions approach above is simpler and covers all three at once.
