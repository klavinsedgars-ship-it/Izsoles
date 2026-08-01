import type { Scraper, ScrapeContext, ScrapedListing } from "./types.js";
import type { PropertyType } from "../db/schema.js";

/**
 * City24.lv — real-estate portal.
 *
 * City24's frontend is powered by a JSON API (api.city24.lv), which we call
 * directly — much cleaner than scraping HTML. The exact query parameters and
 * response field names are stable-ish but can only be confirmed live, so the
 * request builder and `mapRealty()` are centralised and marked for tuning.
 *
 * Typical endpoint shape:
 *   https://api.city24.lv/lv_LV/search/realties?tsType=sale&unitType=Apartment&itemsPerPage=50&page=1
 */

const API_BASE = "https://api.city24.lv/lv_LV/search/realties";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface City24Query {
  tsType: "sale" | "rent";
  unitType: "Apartment" | "House" | "LandLot" | "CommercialSpace";
  propertyType: PropertyType;
}

const DEFAULT_QUERIES: City24Query[] = [
  { tsType: "sale", unitType: "Apartment", propertyType: "apartment" },
  { tsType: "sale", unitType: "House", propertyType: "house" },
];

function buildUrl(q: City24Query, page: number, itemsPerPage: number): string {
  const params = new URLSearchParams({
    tsType: q.tsType,
    unitType: q.unitType,
    itemsPerPage: String(itemsPerPage),
    page: String(page),
  });
  return `${API_BASE}?${params.toString()}`;
}

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/** Map one City24 realty record. Field names per the public API; tune if changed. */
function mapRealty(r: Record<string, any>, q: City24Query): ScrapedListing | null {
  const id = r.id ?? r.friendly_id ?? r.guid;
  if (id == null) return null;

  const addr = r.address ?? {};
  const cityLabel: string | undefined =
    addr.city_name ?? addr.parish_name ?? addr.county_name ?? undefined;
  const street: string | undefined = addr.street_name ?? addr.street_full ?? undefined;
  const friendly = r.friendly_id ?? id;

  return {
    source: "city24",
    externalId: String(id),
    url: `https://www.city24.lv/en/real-estate/${friendly}`,
    listingKind: q.tsType === "rent" ? "rent" : "sale",
    propertyType: q.propertyType,
    title: [q.propertyType, cityLabel, street].filter(Boolean).join(", ") || undefined,
    cityLabel,
    district: addr.district_name ?? undefined,
    address: [street, cityLabel].filter(Boolean).join(", ") || undefined,
    lat: num(r.latitude ?? addr.latitude),
    lng: num(r.longitude ?? addr.longitude),
    price: num(r.price),
    pricePerM2: num(r.price_per_unit ?? r.price_per_m2),
    areaM2: num(r.property_size ?? r.size),
    rooms: num(r.room_count ?? r.rooms),
    floor: num(r.floor),
    imageUrl:
      r.main_image?.url ?? (Array.isArray(r.images) && r.images[0]?.url) ?? undefined,
    raw: r,
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", "Accept-Language": "lv,en;q=0.8" },
  });
  if (!res.ok) throw new Error(`City24 ${url} -> HTTP ${res.status}`);
  return res.json();
}

export const city24Scraper: Scraper = {
  source: "city24",
  label: "City24.lv (real estate)",

  async scrape(ctx: ScrapeContext): Promise<ScrapedListing[]> {
    const log = ctx.log ?? console.log;
    const seen = new Set<string>();
    const out: ScrapedListing[] = [];
    const perPage = 50;

    for (const q of DEFAULT_QUERIES) {
      try {
        const url = buildUrl(q, 1, perPage);
        const body = await fetchJson(url);
        const arr: Record<string, any>[] = Array.isArray(body)
          ? body
          : Array.isArray((body as any)?.items)
            ? (body as any).items
            : [];
        log(`city24: ${arr.length} records for ${q.tsType}/${q.unitType}`);
        for (const r of arr) {
          const mapped = mapRealty(r, q);
          if (!mapped || seen.has(mapped.externalId)) continue;
          seen.add(mapped.externalId);
          out.push(mapped);
          if (out.length >= ctx.maxListings) return out;
        }
      } catch (e) {
        log(`city24: query failed ${q.tsType}/${q.unitType}: ${(e as Error).message}`);
      }
    }
    return out;
  },
};
