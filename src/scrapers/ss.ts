import * as cheerio from "cheerio";
import type { Scraper, ScrapeContext, ScrapedListing } from "./types.js";
import { parseArea, parsePrice } from "./types.js";

/**
 * SS.com — Latvia's largest classifieds site.
 *
 * SS.com is server-rendered static HTML (a big <table> of rows), so plain
 * fetch + cheerio is enough — no browser needed. Rows have ids like `tr_<id>`.
 * Column order differs slightly per category; we parse defensively by scanning
 * every cell for a price / area / room pattern rather than trusting fixed
 * positions. Selectors are centralised here and marked for live tuning.
 *
 * We aggregate the "recently added" listing pages. Category/city is encoded in
 * the URL path, e.g.:
 *   https://www.ss.com/en/real-estate/flats/riga/all/sell/
 *   https://www.ss.com/en/real-estate/homes-summer-residences/riga-region/sell/
 */

interface SsFeed {
  url: string;
  listingKind: ScrapedListing["listingKind"];
  propertyType: ScrapedListing["propertyType"];
  cityLabel: string;
}

// Seed feeds. Extend/parameterise these once live; they define what SS.com pages
// we poll each run. Kept small for the first pass (Riga sales).
const DEFAULT_FEEDS: SsFeed[] = [
  {
    url: "https://www.ss.com/en/real-estate/flats/riga/all/sell/",
    listingKind: "sale",
    propertyType: "apartment",
    cityLabel: "Rīga",
  },
  {
    url: "https://www.ss.com/en/real-estate/homes-summer-residences/all/sell/",
    listingKind: "sale",
    propertyType: "house",
    cityLabel: "",
  },
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "lv,en;q=0.8" },
  });
  if (!res.ok) throw new Error(`SS.com ${url} -> HTTP ${res.status}`);
  return res.text();
}

function parseFeed(html: string, feed: SsFeed): ScrapedListing[] {
  const $ = cheerio.load(html);
  const out: ScrapedListing[] = [];

  $("tr[id^='tr_']").each((_, el) => {
    const row = $(el);
    const id = (row.attr("id") ?? "").replace(/^tr_/, "");
    if (!id || id === "bnr_head") return;

    const link = row.find("a.am").first();
    const href = link.attr("href");
    if (!href) return;
    const url = href.startsWith("http") ? href : `https://www.ss.com${href}`;
    const title = link.text().trim();

    // Thumbnail image (SS rows carry a small preview). Prefer a larger variant
    // when SS's `.th2`/`.t` thumbnail naming is present, else use it as-is.
    const imgEl = row.find("img").first();
    let imageUrl = imgEl.attr("src") || imgEl.attr("data-original") || undefined;
    if (imageUrl) {
      if (imageUrl.startsWith("//")) imageUrl = "https:" + imageUrl;
      imageUrl = imageUrl.replace(/\.th2\.(jpg|jpeg|png)$/i, ".800.$1").replace(/\.t\.(jpg|jpeg|png)$/i, ".800.$1");
    }

    // Short description snippet, if the row exposes one.
    const description = row.find(".msg_column, .d1, .dd_msg").first().text().trim() || undefined;

    // Collect the numeric-ish data cells (td.msga2-o) in order.
    const cells = row
      .find("td.msga2-o, td.msga2")
      .map((__, c) => $(c).text().trim())
      .get();

    // Defensive extraction: find area (contains a number, no currency) and price
    // (contains €). SS lists price and price/m² — the larger absolute is the price.
    let areaM2: number | undefined;
    let rooms: number | undefined;
    let floor: number | undefined;
    const priceCandidates: number[] = [];

    for (const raw of cells) {
      const cell = raw.trim();
      if (/€|eur/i.test(cell)) {
        const p = parsePrice(cell);
        if (p) priceCandidates.push(p);
      } else if (/^\d{1,3}$/.test(cell) && rooms === undefined && Number(cell) <= 10) {
        rooms = Number(cell);
      } else if (/m²|m2|\d+\.\d/.test(cell) && areaM2 === undefined) {
        areaM2 = parseArea(cell);
      } else if (floor === undefined) {
        // Floor is shown as "current/total", e.g. "5/9". Extract just the
        // leading number via regex so stray text never yields NaN.
        const m = cell.match(/(\d+)\s*\/\s*\d+/);
        if (m?.[1]) floor = Number(m[1]);
      }
    }

    // SS lists both the price and the price/m². The larger absolute value is the
    // total price; derive €/m² from area when we have both.
    const price = priceCandidates.length ? Math.max(...priceCandidates) : undefined;
    const smaller = priceCandidates.length > 1 ? Math.min(...priceCandidates) : undefined;
    const pricePerM2 =
      price && areaM2 ? Math.round(price / areaM2) : smaller && smaller < (price ?? Infinity) ? smaller : undefined;

    out.push({
      source: "ss",
      externalId: id,
      url,
      listingKind: feed.listingKind,
      propertyType: feed.propertyType,
      title: title || undefined,
      description,
      cityLabel: feed.cityLabel || undefined,
      address: title || undefined,
      price,
      pricePerM2,
      areaM2,
      rooms,
      floor,
      imageUrl,
      raw: { cells, feed: feed.url },
    });
  });

  return out;
}

export const ssScraper: Scraper = {
  source: "ss",
  label: "SS.com (classifieds)",

  async scrape(ctx: ScrapeContext): Promise<ScrapedListing[]> {
    const log = ctx.log ?? console.log;
    const seen = new Set<string>();
    const out: ScrapedListing[] = [];

    for (const feed of DEFAULT_FEEDS) {
      try {
        const html = await fetchHtml(feed.url);
        const items = parseFeed(html, feed);
        log(`ss: ${items.length} rows from ${feed.url}`);
        for (const it of items) {
          if (seen.has(it.externalId)) continue;
          seen.add(it.externalId);
          out.push(it);
          if (out.length >= ctx.maxListings) return out;
        }
      } catch (e) {
        log(`ss: feed failed ${feed.url}: ${(e as Error).message}`);
      }
    }
    return out;
  },
};
