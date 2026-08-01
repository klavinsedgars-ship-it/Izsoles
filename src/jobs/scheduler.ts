import cron from "node-cron";
import { runAll } from "./runScrape.js";
import { sendDigests } from "./sendDigests.js";

/**
 * Run the full daily pipeline: scrape all sources, then send digests.
 */
export async function runDailyPipeline(): Promise<void> {
  console.log("[pipeline] starting scrape of all sources…");
  const results = await runAll();
  for (const r of results) {
    console.log(
      `[pipeline] ${r.source}: found=${r.found} inserted=${r.inserted} queued=${r.queued}` +
        (r.error ? ` error=${r.error}` : ""),
    );
  }
  console.log("[pipeline] sending digests…");
  const digest = await sendDigests();
  console.log(
    `[pipeline] digests: searches=${digest.searchesNotified} emails=${digest.emailsSent} listings=${digest.listingsIncluded}`,
  );
  if (digest.errors.length) console.warn("[pipeline] digest errors:", digest.errors);
}

export function startScheduler(): void {
  if ((process.env.SCHEDULER_ENABLED ?? "true") === "false") {
    console.log("[scheduler] disabled via SCHEDULER_ENABLED=false");
    return;
  }
  const expr = process.env.SCRAPE_CRON ?? "0 8 * * *";
  if (!cron.validate(expr)) {
    console.error(`[scheduler] invalid SCRAPE_CRON "${expr}" — scheduler not started`);
    return;
  }
  cron.schedule(expr, () => {
    runDailyPipeline().catch((e) => console.error("[scheduler] pipeline failed:", e));
  });
  console.log(`[scheduler] daily pipeline scheduled: "${expr}"`);
}
