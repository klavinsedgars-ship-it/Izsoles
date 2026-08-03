import type { Browser } from "playwright";
import type { Scraper, ScrapeContext, ScrapedListing } from "./types.js";
import { parsePrice } from "./types.js";
import type { PropertyType } from "../db/schema.js";

/**
 * izsoles.ta.gov.lv — the official Latvian electronic auctions site.
 *
 * The site is a server-rendered jQuery/Bootstrap app (there is no JSON API). The
 * landing page lists auctions, each linking to a detail page at
 * `/izsole/<uuid>`. We drive a headless browser (the site does not respond to
 * plain HTTP the way a browser does), collect the auction links, and parse the
 * summary text of each card. Fields are heuristic and centralised in mapCard().
 */

// Entry points, tried in order until one returns HTTP 200. The site root lists
// auctions; the specific category routes 404, so root is the reliable entry.
const ENTRY_URLS = [
  "https://izsoles.ta.gov.lv/nekustama-ipasuma-izsoles",
  "https://izsoles.ta.gov.lv/",
];

const DEBUG = process.env.IZSOLES_DEBUG === "1";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface RawCard {
  id: string;
  url: string;
  title: string;
  text: string;
}

function guessPropertyType(text: string | undefined): PropertyType | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  if (/dz[īi]vokl|apartment|flat/.test(t)) return "apartment";
  if (/m[āa]ja|house|savrupm/.test(t)) return "house";
  if (/zeme|land|plot|zemes/.test(t)) return "land";
  if (/komerc|birojs|commercial|office|veikal|telp/.test(t)) return "commercial";
  if (/gar[āa]ža|garage/.test(t)) return "garage";
  return "other";
}

/** Parse a Latvian date "dd.mm.yyyy" (optionally with time) into a Date. */
function parseLvDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return undefined;
  const [, dd, mm, yyyy, hh = "0", min = "0"] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Map one auction card (from the listing page) to our normalized shape. */
function mapCard(c: RawCard): ScrapedListing | null {
  if (!c.id) return null;
  const text = c.text ?? "";

  // Starting price ("Sākumcena"), else the first EUR amount in the card text.
  const priceRaw =
    text.match(/s[āa]kumcena[^0-9]{0,20}([0-9][0-9\s.,]*)\s*(?:EUR|€)/i)?.[1] ??
    text.match(/([0-9][0-9\s.,]{2,})\s*(?:EUR|€)/i)?.[1];
  const price = parsePrice(priceRaw);

  const start = text.match(/s[āa]kum[^0-9]{0,20}(\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2})?)/i)?.[1];
  const end = text.match(
    /nosl[ēe]gum[^0-9]{0,20}(\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2})?)/i,
  )?.[1];

  // Title/address: the link text is usually the object name/address.
  const title = c.title || text.slice(0, 120) || undefined;

  return {
    source: "izsoles",
    externalId: c.id,
    url: c.url,
    listingKind: "auction",
    propertyType: guessPropertyType(`${title ?? ""} ${text}`),
    title,
    address: title,
    price,
    auctionStart: parseLvDate(start),
    auctionEnd: parseLvDate(end),
    raw: c,
  };
}

// Collects every /izsole/<uuid> auction link on the current page along with the
// text of its surrounding card. Runs inside the browser; returns plain data.
const COLLECT_JS = `(() => {
  const seen = new Set();
  const out = [];
  const links = Array.from(document.querySelectorAll('a[href*="/izsole/"]'));
  for (const a of links) {
    const href = a.getAttribute('href') || '';
    const i = href.indexOf('/izsole/');
    if (i < 0) continue;
    const id = href.slice(i + 8).split(/[\\/?#]/)[0];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    let el = a, up = 0;
    while (el.parentElement && (el.textContent || '').replace(/\\s+/g, ' ').trim().length < 60 && up < 6) {
      el = el.parentElement; up++;
    }
    out.push({
      id,
      url: a.href,
      title: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 140),
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 500),
    });
  }
  return out;
})()`;

export const izsolesScraper: Scraper = {
  source: "izsoles",
  label: "izsoles.ta.gov.lv (auctions)",

  async scrape(ctx: ScrapeContext): Promise<ScrapedListing[]> {
    const log = ctx.log ?? console.log;
    let browser: Browser | undefined;

    try {
      const { chromium } = await import("playwright");
      try {
        browser = await chromium.launch({ headless: true });
      } catch (e) {
        log(
          "izsoles: headless browser not available here — this source runs in the " +
            `scheduled GitHub Actions worker. (${(e as Error).message.split("\n")[0]})`,
        );
        return [];
      }
      const page = await browser.newPage({ userAgent: UA, locale: "lv-LV" });

      let loaded = false;
      for (const entry of ENTRY_URLS) {
        try {
          const resp = await page.goto(entry, { waitUntil: "networkidle", timeout: 45_000 });
          if ((resp?.status() ?? 0) >= 400) {
            log(`izsoles: ${entry} returned HTTP ${resp?.status()}; trying next`);
            continue;
          }
          log(`izsoles: loaded ${entry}`);
          loaded = true;
          break;
        } catch (e) {
          log(`izsoles: ${entry} failed (${(e as Error).message}); trying next`);
        }
      }
      if (!loaded) throw new Error("could not load any izsoles entry URL");
      await page.waitForTimeout(2500);

      // If the landing page links to a dedicated real-estate auctions list, open
      // it to get the full set rather than only what's on the homepage.
      const browseHref = (await page
        .evaluate(
          `(() => {
            const as = Array.from(document.querySelectorAll('a[href]'));
            const a = as.find(x => /nekustam\\w* ?[īi]pa\\w* izsol/i.test(x.textContent || ''));
            return a && a.href && a.href.indexOf('/izsole/') < 0 ? a.href : null;
          })()`,
        )
        .catch(() => null)) as string | null;
      if (browseHref) {
        log(`izsoles: opening real-estate list ${browseHref}`);
        try {
          await page.goto(browseHref, { waitUntil: "networkidle", timeout: 45_000 });
          await page.waitForTimeout(2500);
        } catch (e) {
          log(`izsoles: could not open list ${browseHref}: ${(e as Error).message}`);
        }
      }

      const cards = ((await page.evaluate(COLLECT_JS).catch(() => [])) as RawCard[]) ?? [];
      log(`izsoles: found ${cards.length} auction links on ${page.url()}`);
      if (DEBUG && cards[0]) log(`izsoles[debug] sample card: ${JSON.stringify(cards[0]).slice(0, 700)}`);

      const seen = new Set<string>();
      const out: ScrapedListing[] = [];
      for (const c of cards) {
        const mapped = mapCard(c);
        if (!mapped || seen.has(mapped.externalId)) continue;
        seen.add(mapped.externalId);
        out.push(mapped);
        if (out.length >= ctx.maxListings) break;
      }

      if (out.length === 0) {
        log("izsoles: no auction cards found — the listing markup may have changed.");
      }
      return out;
    } finally {
      await browser?.close().catch(() => {});
    }
  },
};
