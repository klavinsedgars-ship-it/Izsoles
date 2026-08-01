import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * The three sources we aggregate.
 */
export const SOURCES = ["izsoles", "city24", "ss"] as const;
export type Source = (typeof SOURCES)[number];

/**
 * How a property is being offered.
 *  - auction : forced/voluntary auction (izsoles.ta.gov.lv)
 *  - sale    : normal for-sale listing (City24 / SS)
 *  - rent    : rental listing (City24 / SS)
 */
export const LISTING_KINDS = ["auction", "sale", "rent"] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

export const PROPERTY_TYPES = [
  "apartment",
  "house",
  "land",
  "commercial",
  "garage",
  "other",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/**
 * A normalized listing, deduplicated across scrape runs.
 * One row per (source, externalId).
 */
export const listings = pgTable(
  "listings",
  {
    id: serial("id").primaryKey(),
    source: text("source").$type<Source>().notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),

    listingKind: text("listing_kind").$type<ListingKind>().notNull(),
    propertyType: text("property_type").$type<PropertyType>(),

    title: text("title"),
    description: text("description"),

    // Location
    city: text("city"), // normalized lowercase city/region name for matching
    cityLabel: text("city_label"), // original display label
    district: text("district"),
    address: text("address"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),

    // Money (whole euros; null if unknown)
    price: integer("price"),
    currency: text("currency").default("EUR"),
    pricePerM2: integer("price_per_m2"),

    // Physical
    areaM2: doublePrecision("area_m2"),
    rooms: integer("rooms"),
    floor: integer("floor"),

    // Auction-specific (null for plain sale/rent)
    auctionStart: timestamp("auction_start", { withTimezone: true }),
    auctionEnd: timestamp("auction_end", { withTimezone: true }),
    deposit: integer("deposit"),
    cadastralNumber: text("cadastral_number"),

    imageUrl: text("image_url"),

    // Full source payload for debugging / future fields
    raw: jsonb("raw"),

    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceExternalIdx: uniqueIndex("listings_source_external_idx").on(t.source, t.externalId),
    cityIdx: index("listings_city_idx").on(t.city),
    firstSeenIdx: index("listings_first_seen_idx").on(t.firstSeenAt),
  }),
);

/**
 * A user-defined saved search. When a new listing matches its criteria,
 * it is queued for the next email digest to `email`.
 */
export const savedSearches = pgTable("saved_searches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  active: boolean("active").notNull().default(true),

  // Criteria — all optional; empty array / null means "no restriction".
  sources: jsonb("sources").$type<Source[]>().notNull().default([]),
  listingKinds: jsonb("listing_kinds").$type<ListingKind[]>().notNull().default([]),
  propertyTypes: jsonb("property_types").$type<PropertyType[]>().notNull().default([]),
  cities: jsonb("cities").$type<string[]>().notNull().default([]), // normalized lowercase

  priceMin: integer("price_min"),
  priceMax: integer("price_max"),
  areaMin: doublePrecision("area_min"),
  areaMax: doublePrecision("area_max"),
  roomsMin: integer("rooms_min"),
  roomsMax: integer("rooms_max"),

  // Free-text keywords matched against title/description/address (any-of).
  keywords: jsonb("keywords").$type<string[]>().notNull().default([]),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Records that a given listing was matched to a saved search and emailed.
 * Guarantees we never email the same (search, listing) pair twice.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    savedSearchId: integer("saved_search_id")
      .notNull()
      .references(() => savedSearches.id, { onDelete: "cascade" }),
    listingId: integer("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    // "pending" -> queued for digest, "sent" -> included in a delivered email, "failed"
    status: text("status").$type<"pending" | "sent" | "failed">().notNull().default("pending"),
    matchedAt: timestamp("matched_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => ({
    uniqPair: uniqueIndex("notifications_search_listing_idx").on(t.savedSearchId, t.listingId),
    statusIdx: index("notifications_status_idx").on(t.status),
  }),
);

/**
 * Audit log of each scrape run per source.
 */
export const scrapeRuns = pgTable("scrape_runs", {
  id: serial("id").primaryKey(),
  source: text("source").$type<Source>().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").$type<"running" | "ok" | "error">().notNull().default("running"),
  found: integer("found").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  error: text("error"),
});

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
export type SavedSearch = typeof savedSearches.$inferSelect;
export type NewSavedSearch = typeof savedSearches.$inferInsert;
