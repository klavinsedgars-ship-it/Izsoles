import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { listings, notifications, savedSearches, scrapeRuns } from "../db/schema.js";
import type { Listing, NewListing, Source } from "../db/schema.js";
import { getScraper, normalizeCity, type ScrapedListing } from "../scrapers/index.js";
import { listingMatches } from "../core/match.js";

const MAX = Number(process.env.MAX_LISTINGS_PER_SOURCE ?? 200);

// Coerce to a safe DB value: a non-finite number (NaN/Infinity) from a scraper
// must become null, or Postgres rejects the insert ("invalid input syntax for
// type integer: NaN"). `int` rounds for integer columns; `flt` keeps decimals.
const int = (v: number | undefined | null): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
const flt = (v: number | undefined | null): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function toRow(s: ScrapedListing): NewListing {
  return {
    source: s.source,
    externalId: s.externalId,
    url: s.url,
    listingKind: s.listingKind,
    propertyType: s.propertyType,
    title: s.title,
    description: s.description,
    city: normalizeCity(s.cityLabel),
    cityLabel: s.cityLabel,
    district: s.district,
    address: s.address,
    lat: flt(s.lat),
    lng: flt(s.lng),
    price: int(s.price),
    currency: s.currency ?? "EUR",
    pricePerM2: int(s.pricePerM2),
    areaM2: flt(s.areaM2),
    rooms: int(s.rooms),
    floor: int(s.floor),
    auctionStart: s.auctionStart,
    auctionEnd: s.auctionEnd,
    deposit: int(s.deposit),
    cadastralNumber: s.cadastralNumber,
    imageUrl: s.imageUrl,
    raw: s.raw ?? null,
  };
}

/**
 * Insert new listings, refresh lastSeenAt (and mutable fields) on ones we've
 * seen before. Returns only the rows that were newly inserted this run.
 */
async function upsertListings(source: Source, scraped: ScrapedListing[]): Promise<Listing[]> {
  if (scraped.length === 0) return [];

  const ids = scraped.map((s) => s.externalId);
  const existing = await db
    .select({ externalId: listings.externalId })
    .from(listings)
    .where(and(eq(listings.source, source), inArray(listings.externalId, ids)));
  const existingSet = new Set(existing.map((e) => e.externalId));

  const fresh = scraped.filter((s) => !existingSet.has(s.externalId));
  const stale = scraped.filter((s) => existingSet.has(s.externalId));

  let inserted: Listing[] = [];
  if (fresh.length) {
    inserted = await db.insert(listings).values(fresh.map(toRow)).returning();
  }

  // Refresh existing rows (price can change, and lastSeenAt tracks liveness).
  const now = new Date();
  for (const s of stale) {
    const row = toRow(s);
    await db
      .update(listings)
      .set({
        lastSeenAt: now,
        price: row.price,
        pricePerM2: row.pricePerM2,
        auctionEnd: row.auctionEnd,
      })
      .where(and(eq(listings.source, source), eq(listings.externalId, s.externalId)));
  }

  return inserted;
}

/**
 * For each newly inserted listing, queue a pending notification for every
 * active saved search it matches. The unique (search, listing) index makes this
 * idempotent, so re-running is safe.
 */
async function queueNotifications(newListings: Listing[]): Promise<number> {
  if (newListings.length === 0) return 0;
  const searches = await db.select().from(savedSearches).where(eq(savedSearches.active, true));
  if (searches.length === 0) return 0;

  let queued = 0;
  for (const listing of newListings) {
    for (const search of searches) {
      if (!listingMatches(listing, search)) continue;
      const res = await db
        .insert(notifications)
        .values({ savedSearchId: search.id, listingId: listing.id, status: "pending" })
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      if (res.length) queued++;
    }
  }
  return queued;
}

export interface SourceRunResult {
  source: Source;
  found: number;
  inserted: number;
  queued: number;
  error?: string;
}

/** Scrape a single source end-to-end: fetch -> persist -> queue matches. */
export async function runSource(source: Source): Promise<SourceRunResult> {
  const scraper = await getScraper(source);
  const [run] = await db.insert(scrapeRuns).values({ source, status: "running" }).returning();

  try {
    const scraped = await scraper.scrape({
      maxListings: MAX,
      log: (m) => console.log(`[${source}] ${m}`),
    });
    const inserted = await upsertListings(source, scraped);
    const queued = await queueNotifications(inserted);

    await db
      .update(scrapeRuns)
      .set({
        status: "ok",
        finishedAt: new Date(),
        found: scraped.length,
        inserted: inserted.length,
      })
      .where(eq(scrapeRuns.id, run!.id));

    return { source, found: scraped.length, inserted: inserted.length, queued };
  } catch (e) {
    const error = (e as Error).message;
    await db
      .update(scrapeRuns)
      .set({ status: "error", finishedAt: new Date(), error })
      .where(eq(scrapeRuns.id, run!.id));
    return { source, found: 0, inserted: 0, queued: 0, error };
  }
}

/** Scrape every source (or a subset). */
export async function runAll(sources?: Source[]): Promise<SourceRunResult[]> {
  const list = sources ?? (["izsoles", "city24", "ss"] as Source[]);
  const results: SourceRunResult[] = [];
  for (const s of list) {
    results.push(await runSource(s));
  }
  return results;
}
