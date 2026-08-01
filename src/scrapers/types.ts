import type { ListingKind, PropertyType, Source } from "../db/schema.js";

/**
 * A listing as produced by a scraper, before it is persisted.
 * `externalId` must be stable for the same real-world listing so we can dedup.
 */
export interface ScrapedListing {
  source: Source;
  externalId: string;
  url: string;

  listingKind: ListingKind;
  propertyType?: PropertyType;

  title?: string;
  description?: string;

  cityLabel?: string; // original label, e.g. "Rīga", "Jūrmala"
  district?: string;
  address?: string;
  lat?: number;
  lng?: number;

  price?: number; // whole euros
  currency?: string;
  pricePerM2?: number;

  areaM2?: number;
  rooms?: number;
  floor?: number;

  auctionStart?: Date;
  auctionEnd?: Date;
  deposit?: number;
  cadastralNumber?: string;

  imageUrl?: string;
  raw?: unknown;
}

export interface ScrapeContext {
  /** Hard cap on how many listings to return in one run. */
  maxListings: number;
  /** Optional logger; defaults to console. */
  log?: (msg: string) => void;
}

export interface Scraper {
  source: Source;
  /** Human-readable name for logs/UI. */
  label: string;
  /**
   * Fetch the current set of relevant listings. Should NOT throw for empty
   * results — return []. May throw on hard failures (network/blocked).
   */
  scrape(ctx: ScrapeContext): Promise<ScrapedListing[]>;
}

/**
 * Normalize a Latvian city/region label into a lowercase, diacritic-stripped
 * key so that user criteria ("riga") match listings ("Rīga", "RĪGA", "Riga").
 */
export function normalizeCity(label: string | undefined | null): string {
  if (!label) return "";
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/\s+/g, " ");
}

/** Parse a price string like "12 500,00 €" / "€12,500" / "45000" into whole euros. */
export function parsePrice(input: string | number | undefined | null): number | undefined {
  if (input == null) return undefined;
  if (typeof input === "number") return Math.round(input);
  // Remove currency symbols and spaces used as thousands separators.
  let s = input.replace(/[^\d.,]/g, "").trim();
  if (!s) return undefined;
  // Latvian format often "12 500,00" -> "12500.00". Handle comma decimal.
  if (s.includes(",") && s.includes(".")) {
    // Assume "." thousands, "," decimal (EU) unless last sep is "."
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    const parts = s.split(",");
    const last = parts[parts.length - 1] ?? "";
    // Multiple commas, or a single comma followed by exactly 3 digits, means the
    // comma is a thousands separator (e.g. "1,234,567" or "12,500"). A comma
    // followed by 1–2 digits is a decimal separator (Latvian "56,3" / "12,50").
    if (parts.length > 2 || last.length === 3) {
      s = s.replace(/,/g, "");
    } else {
      s = s.replace(",", ".");
    }
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/** Parse an area like "56,3 m²" / "56.3" into a float. */
export function parseArea(input: string | number | undefined | null): number | undefined {
  if (input == null) return undefined;
  if (typeof input === "number") return input;
  const m = input.replace(/\s/g, "").match(/(\d+(?:[.,]\d+)?)/);
  if (!m || m[1] === undefined) return undefined;
  const n = Number.parseFloat(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}
