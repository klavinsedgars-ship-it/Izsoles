import { Router, type Request, type Response, type NextFunction } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { listings, notifications, savedSearches, scrapeRuns } from "../db/schema.js";
import type { Source } from "../db/schema.js";
import { SOURCES } from "../db/schema.js";
import { normalizeCity } from "../scrapers/types.js";
import { savedSearchInput } from "./validation.js";
import { runAll, runSource } from "../jobs/runScrape.js";
import { sendDigests, backfillSearch } from "../jobs/sendDigests.js";

export const api = Router();

// Express 4 does not forward rejected promises from async handlers to the error
// middleware, so wrap every async handler. Any thrown/rejected error (including
// a missing DB connection) becomes a clean JSON 500 instead of a hung request or
// an opaque platform HTML error page.
type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;
const ah =
  (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

/* ---------------- Saved searches ---------------- */

api.get(
  "/searches",
  ah(async (_req, res) => {
    const rows = await db.select().from(savedSearches).orderBy(desc(savedSearches.createdAt));
    res.json(rows);
  }),
);

api.post(
  "/searches",
  ah(async (req, res) => {
    const parsed = savedSearchInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const data = parsed.data;
    const [row] = await db
      .insert(savedSearches)
      .values({ ...data, cities: data.cities.map(normalizeCity) })
      .returning();
    // Backfill against recent listings so the next digest isn't empty.
    const queued = await backfillSearch(row!.id).catch(() => 0);
    res.status(201).json({ search: row, backfilled: queued });
  }),
);

api.put(
  "/searches/:id",
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const parsed = savedSearchInput.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;
    const [row] = await db
      .update(savedSearches)
      .set({
        ...data,
        ...(data.cities ? { cities: data.cities.map(normalizeCity) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(savedSearches.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  }),
);

api.delete(
  "/searches/:id",
  ah(async (req, res) => {
    const id = Number(req.params.id);
    await db.delete(savedSearches).where(eq(savedSearches.id, id));
    res.status(204).end();
  }),
);

/* ---------------- Listings & history ---------------- */

api.get(
  "/listings",
  ah(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const source = req.query.source as Source | undefined;
    const base = db.select().from(listings).orderBy(desc(listings.firstSeenAt)).limit(limit);
    const rows =
      source && SOURCES.includes(source)
        ? await db
            .select()
            .from(listings)
            .where(eq(listings.source, source))
            .orderBy(desc(listings.firstSeenAt))
            .limit(limit)
        : await base;
    res.json(rows);
  }),
);

api.get(
  "/history",
  ah(async (_req, res) => {
    // Recent notifications joined with listing + search for a "what was sent" view.
    const rows = await db
      .select({
        id: notifications.id,
        status: notifications.status,
        matchedAt: notifications.matchedAt,
        sentAt: notifications.sentAt,
        searchName: savedSearches.name,
        email: savedSearches.email,
        title: listings.title,
        url: listings.url,
        price: listings.price,
        source: listings.source,
      })
      .from(notifications)
      .leftJoin(savedSearches, eq(notifications.savedSearchId, savedSearches.id))
      .leftJoin(listings, eq(notifications.listingId, listings.id))
      .orderBy(desc(notifications.matchedAt))
      .limit(100);
    res.json(rows);
  }),
);

api.get(
  "/runs",
  ah(async (_req, res) => {
    const rows = await db.select().from(scrapeRuns).orderBy(desc(scrapeRuns.startedAt)).limit(30);
    res.json(rows);
  }),
);

/* ---------------- Manual triggers ---------------- */

api.post(
  "/run",
  ah(async (req, res) => {
    const source = req.body?.source as Source | undefined;
    // On serverless (Vercel) there is no browser, so izsoles can't run here — it
    // runs in the scheduled GitHub Actions worker. A manual "run all" from the
    // web UI therefore covers only the browserless sources.
    const serverless = Boolean(process.env.VERCEL);
    const results = source
      ? [await runSource(source)]
      : await runAll(serverless ? (["city24", "ss"] as Source[]) : undefined);
    res.json({
      results,
      ...(serverless && !source
        ? { note: "izsoles runs in the scheduled GitHub Actions worker, not from this button." }
        : {}),
    });
  }),
);

api.post(
  "/digest",
  ah(async (_req, res) => {
    const result = await sendDigests();
    res.json(result);
  }),
);

api.get("/meta", (_req, res) => {
  res.json({
    sources: SOURCES,
    emailConfigured: Boolean(process.env.RESEND_API_KEY),
    schedule: process.env.SCRAPE_CRON ?? "0 8 * * *",
  });
});
