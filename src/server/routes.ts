import { Router } from "express";
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

/* ---------------- Saved searches ---------------- */

api.get("/searches", async (_req, res) => {
  const rows = await db.select().from(savedSearches).orderBy(desc(savedSearches.createdAt));
  res.json(rows);
});

api.post("/searches", async (req, res) => {
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
});

api.put("/searches/:id", async (req, res) => {
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
});

api.delete("/searches/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(savedSearches).where(eq(savedSearches.id, id));
  res.status(204).end();
});

/* ---------------- Listings & history ---------------- */

api.get("/listings", async (req, res) => {
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
});

api.get("/history", async (_req, res) => {
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
});

api.get("/runs", async (_req, res) => {
  const rows = await db.select().from(scrapeRuns).orderBy(desc(scrapeRuns.startedAt)).limit(30);
  res.json(rows);
});

/* ---------------- Manual triggers ---------------- */

api.post("/run", async (req, res) => {
  const source = req.body?.source as Source | undefined;
  try {
    const results = source ? [await runSource(source)] : await runAll();
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

api.post("/digest", async (_req, res) => {
  try {
    const result = await sendDigests();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

api.get("/meta", (_req, res) => {
  res.json({
    sources: SOURCES,
    emailConfigured: Boolean(process.env.RESEND_API_KEY),
    schedule: process.env.SCRAPE_CRON ?? "0 8 * * *",
  });
});
