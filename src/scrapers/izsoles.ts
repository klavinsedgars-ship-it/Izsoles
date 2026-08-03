import type { Browser } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Scraper, ScrapeContext, ScrapedListing } from "./types.js";
import { parseArea, parsePrice } from "./types.js";
import type { PropertyType } from "../db/schema.js";

/**
 * izsoles.ta.gov.lv — the official Latvian electronic auctions site.
 *
 * The site is a single-page app protected against naive HTTP scraping
 * (Cloudflare / bot checks), so we drive a real headless browser and, crucially,
 * INTERCEPT the JSON the frontend fetches for itself. That is far more robust
 * than scraping rendered HTML: even if the visual layout changes, the data API
 * tends to stay stable, and we don't have to guess CSS selectors.
 *
 * Because the exact API shape can only be confirmed against the live site (which
 * is unreachable from the build sandbox), the field mapping below is heuristic
 * and centralised in `mapRecord()`. Run once with IZSOLES_DEBUG=1 to dump the
 * raw discovered payloads to ./debug/ and finalise the mapping.
 */

// Real-estate auction category landing pages. The site groups
// "Nekustamā īpašuma izsoles" (real-estate auctions) under these routes.
const ENTRY_URLS = [
  "https://izsoles.ta.gov.lv/nekustama-ipasuma-izsoles",
  "https://izsoles.ta.gov.lv/lv/nekustama-ipasuma-izsoles",
  "https://izsoles.ta.gov.lv/",
];

// A response is considered a candidate listings payload if its URL matches this
// and its body contains an array of objects that look like auction records.
const API_URL_HINT = /(auction|izsol|lot|object|search|list|result)/i;

const DEBUG = process.env.IZSOLES_DEBUG === "1";

function looksLikeListingArray(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const sample = value[0];
  if (typeof sample !== "object" || sample === null) return false;
  const keys = Object.keys(sample).join(" ").toLowerCase();
  // Heuristic: auction records mention a price, address, or dates.
  return /(price|cena|sum|address|adrese|street|iela|date|datum|deadline|term|start|end)/.test(
    keys,
  );
}

/** Recursively search a decoded JSON body for the first listing-like array. */
function findListingArray(body: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 6 || body == null) return null;
  if (looksLikeListingArray(body)) return body;
  if (Array.isArray(body)) {
    for (const el of body) {
      const found = findListingArray(el, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof body === "object") {
    for (const val of Object.values(body as Record<string, unknown>)) {
      const found = findListingArray(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function pick<T = unknown>(rec: Record<string, unknown>, keys: string[]): T | undefined {
  for (const k of Object.keys(rec)) {
    const lk = k.toLowerCase();
    if (keys.some((want) => lk === want || lk.includes(want))) {
      const v = rec[k];
      if (v !== null && v !== "") return v as T;
    }
  }
  return undefined;
}

function toDate(v: unknown): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function guessPropertyType(text: string | undefined): PropertyType | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  if (/dz[īi]vokl|apartment|flat/.test(t)) return "apartment";
  if (/m[āa]ja|house|savrupm/.test(t)) return "house";
  if (/zeme|land|plot/.test(t)) return "land";
  if (/komerc|birojs|commercial|office|veikal/.test(t)) return "commercial";
  if (/gar[āa]ža|garage/.test(t)) return "garage";
  return "other";
}

/** Heuristic mapping from a raw API record to our normalized shape. */
function mapRecord(rec: Record<string, unknown>): ScrapedListing | null {
  const id =
    pick<string | number>(rec, ["id", "uuid", "guid", "number", "nr"]) ??
    pick<string | number>(rec, ["code"]);
  if (id == null) return null;

  const title = pick<string>(rec, ["title", "name", "nosaukum", "heading"]);
  const address = pick<string>(rec, ["address", "adrese", "location", "vieta"]);
  const cityLabel = pick<string>(rec, ["city", "pilseta", "novads", "region", "municipal"]);
  const priceRaw = pick(rec, ["startprice", "startingprice", "cena", "price", "sakumcena", "sum"]);
  const areaRaw = pick(rec, ["area", "platiba", "size", "kvadrat"]);
  const depositRaw = pick(rec, ["deposit", "nodrosinajum", "guarantee"]);

  const url =
    pick<string>(rec, ["url", "link", "permalink"]) ??
    `https://izsoles.ta.gov.lv/nekustama-ipasuma-izsoles/${id}`;

  return {
    source: "izsoles",
    externalId: String(id),
    url: url.startsWith("http") ? url : `https://izsoles.ta.gov.lv${url}`,
    listingKind: "auction",
    propertyType: guessPropertyType(`${title ?? ""} ${pick<string>(rec, ["type", "veids"]) ?? ""}`),
    title: title ?? address,
    description: pick<string>(rec, ["description", "apraksts", "text"]),
    cityLabel: cityLabel ?? undefined,
    address: address ?? undefined,
    price: parsePrice(priceRaw as string | number),
    deposit: parsePrice(depositRaw as string | number),
    areaM2: parseArea(areaRaw as string | number),
    cadastralNumber: pick<string>(rec, ["cadastr", "kadastr"]),
    auctionStart: toDate(pick(rec, ["start", "sakum", "begindate", "datefrom"])),
    auctionEnd: toDate(pick(rec, ["end", "beigu", "enddate", "dateto", "deadline", "term"])),
    imageUrl: pick<string>(rec, ["image", "photo", "attels", "thumbnail"]),
    raw: rec,
  };
}

export const izsolesScraper: Scraper = {
  source: "izsoles",
  label: "izsoles.ta.gov.lv (auctions)",

  async scrape(ctx: ScrapeContext): Promise<ScrapedListing[]> {
    const log = ctx.log ?? console.log;
    let browser: Browser | undefined;
    const captured: Record<string, unknown>[] = [];
    const debugDumps: { url: string; sample: unknown }[] = [];

    try {
      // Lazy-load Playwright so importing this module (e.g. inside a Vercel
      // serverless function) never pulls in the browser dependency. Only the
      // dedicated worker that actually runs izsoles needs Chromium installed.
      const { chromium } = await import("playwright");
      try {
        browser = await chromium.launch({ headless: true });
      } catch (e) {
        // No browser in this environment (e.g. Vercel serverless). izsoles is
        // designed to run in the GitHub Actions worker; degrade gracefully
        // instead of surfacing Playwright's raw "install browsers" banner.
        log(
          "izsoles: headless browser not available here — this source runs in the " +
            `scheduled GitHub Actions worker. (${(e as Error).message.split("\n")[0]})`,
        );
        return [];
      }
      const page = await browser.newPage({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        locale: "lv-LV",
      });

      page.on("response", async (resp) => {
        try {
          const url = resp.url();
          const ct = resp.headers()["content-type"] ?? "";
          // Inspect any JSON-ish response, or anything whose URL looks like an
          // API — don't require both, since the real endpoint may not advertise
          // a JSON content-type or match our keyword hint.
          const isJson = ct.includes("json");
          if (!isJson && !API_URL_HINT.test(url)) return;
          const body = await resp.json().catch(() => null);
          if (!body) return;
          const arr = findListingArray(body);
          if (DEBUG) {
            const topKeys =
              body && typeof body === "object" && !Array.isArray(body)
                ? Object.keys(body as Record<string, unknown>).slice(0, 12).join(",")
                : Array.isArray(body)
                  ? `array[${body.length}]`
                  : typeof body;
            log(`izsoles[debug] JSON ${resp.status()} ${url} :: {${topKeys}} arrayFound=${!!arr}`);
          }
          if (arr) {
            captured.push(...arr);
            if (DEBUG)
              debugDumps.push({ url, sample: arr[0] });
            log(`izsoles: captured ${arr.length} records from ${url}`);
          }
        } catch {
          /* ignore individual response errors */
        }
      });

      let loaded = false;
      for (const entry of ENTRY_URLS) {
        try {
          log(`izsoles: opening ${entry}`);
          await page.goto(entry, { waitUntil: "networkidle", timeout: 45_000 });
          loaded = true;
          break;
        } catch (e) {
          log(`izsoles: ${entry} failed (${(e as Error).message}); trying next entry`);
        }
      }
      if (!loaded) throw new Error("could not load any izsoles entry URL");

      // Give late XHRs a moment, and try to page through results if a "next" exists.
      await page.waitForTimeout(2500);

      if (DEBUG && debugDumps.length) {
        await mkdir(join(process.cwd(), "debug")).catch(() => {});
        await writeFile(
          join(process.cwd(), "debug", "izsoles-sample.json"),
          JSON.stringify(debugDumps, null, 2),
        );
        log(`izsoles: wrote debug/izsoles-sample.json`);
      }

      // Dedup captured records by external id and map.
      const seen = new Set<string>();
      const out: ScrapedListing[] = [];
      for (const rec of captured) {
        const mapped = mapRecord(rec);
        if (!mapped) continue;
        if (seen.has(mapped.externalId)) continue;
        seen.add(mapped.externalId);
        out.push(mapped);
        if (out.length >= ctx.maxListings) break;
      }

      if (out.length === 0) {
        log(
          "izsoles: no records captured. The site likely changed its API or blocked the request. " +
            "Run with IZSOLES_DEBUG=1 in a networked environment to inspect payloads.",
        );
      }
      return out;
    } finally {
      await browser?.close().catch(() => {});
    }
  },
};
