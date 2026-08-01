import type { Source } from "../db/schema.js";
import type { Scraper } from "./types.js";

/**
 * Scrapers are loaded lazily via dynamic import so that importing this module
 * (e.g. from the web API running in a Vercel serverless function) does NOT pull
 * in a scraper's heavy dependencies until that specific source actually runs.
 * In particular this keeps Playwright out of the serverless bundle — only the
 * dedicated worker that runs `izsoles` needs a browser.
 */
export async function getScraper(source: Source): Promise<Scraper> {
  switch (source) {
    case "izsoles":
      return (await import("./izsoles.js")).izsolesScraper;
    case "city24":
      return (await import("./city24.js")).city24Scraper;
    case "ss":
      return (await import("./ss.js")).ssScraper;
    default: {
      const _exhaustive: never = source;
      throw new Error(`unknown source: ${_exhaustive}`);
    }
  }
}

export * from "./types.js";
