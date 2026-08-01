import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { listings, notifications, savedSearches } from "../db/schema.js";
import type { Listing } from "../db/schema.js";
import { buildDigestEmail } from "../email/template.js";
import { sendEmail } from "../email/resend.js";

export interface DigestResult {
  searchesNotified: number;
  emailsSent: number;
  listingsIncluded: number;
  errors: string[];
}

/**
 * Gather all pending notifications, group them per saved search, send one
 * digest email per search, and mark the notifications as sent (or failed).
 */
export async function sendDigests(): Promise<DigestResult> {
  const result: DigestResult = {
    searchesNotified: 0,
    emailsSent: 0,
    listingsIncluded: 0,
    errors: [],
  };

  const pending = await db
    .select()
    .from(notifications)
    .where(eq(notifications.status, "pending"));
  if (pending.length === 0) return result;

  // Group pending notifications by saved search.
  const bySearch = new Map<number, typeof pending>();
  for (const n of pending) {
    const arr = bySearch.get(n.savedSearchId) ?? [];
    arr.push(n);
    bySearch.set(n.savedSearchId, arr);
  }

  for (const [searchId, notifs] of bySearch) {
    const [search] = await db.select().from(savedSearches).where(eq(savedSearches.id, searchId));
    if (!search || !search.active) continue;

    const listingIds = notifs.map((n) => n.listingId);
    const matched: Listing[] = await db
      .select()
      .from(listings)
      .where(inArray(listings.id, listingIds));
    if (matched.length === 0) continue;

    const { subject, html, text } = buildDigestEmail(search, matched);
    const send = await sendEmail({ to: search.email, subject, html, text });

    const notifIds = notifs.map((n) => n.id);
    if (send.ok) {
      await db
        .update(notifications)
        .set({ status: "sent", sentAt: new Date() })
        .where(inArray(notifications.id, notifIds));
      result.searchesNotified++;
      result.emailsSent += send.skipped ? 0 : 1;
      result.listingsIncluded += matched.length;
    } else {
      await db
        .update(notifications)
        .set({ status: "failed" })
        .where(inArray(notifications.id, notifIds));
      result.errors.push(`search ${searchId}: ${send.error}`);
    }
  }

  return result;
}

/**
 * Backfill: when a new saved search is created, match it against listings we've
 * already collected so the user gets relevant existing listings on the next
 * digest instead of only future ones.
 */
export async function backfillSearch(searchId: number, sinceDays = 7): Promise<number> {
  const [search] = await db.select().from(savedSearches).where(eq(savedSearches.id, searchId));
  if (!search) return 0;

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const recent = await db.select().from(listings);
  const { listingMatches } = await import("../core/match.js");

  let queued = 0;
  for (const l of recent) {
    if (l.firstSeenAt < since) continue;
    if (!listingMatches(l, search)) continue;
    const res = await db
      .insert(notifications)
      .values({ savedSearchId: search.id, listingId: l.id, status: "pending" })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (res.length) queued++;
  }
  return queued;
}
