import "dotenv/config";
import { runAll, runSource } from "./jobs/runScrape.js";
import { sendDigests } from "./jobs/sendDigests.js";
import { runDailyPipeline } from "./jobs/scheduler.js";
import { SOURCES, type Source } from "./db/schema.js";
import { pool } from "./db/index.js";

/**
 * Small CLI so scrapes/digests can be triggered manually or from an external
 * scheduler (cron, GitHub Actions, Replit Scheduled Deployment).
 *
 *   tsx src/cli.ts scrape                 # scrape all sources
 *   tsx src/cli.ts scrape --source izsoles
 *   tsx src/cli.ts digest                 # send pending digests
 *   tsx src/cli.ts pipeline               # scrape all + digest
 */
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  const sourceFlagIdx = rest.indexOf("--source");
  const source =
    sourceFlagIdx >= 0 ? (rest[sourceFlagIdx + 1] as Source | undefined) : undefined;
  if (source && !SOURCES.includes(source)) {
    throw new Error(`unknown source "${source}". Valid: ${SOURCES.join(", ")}`);
  }

  switch (cmd) {
    case "scrape": {
      const results = source ? [await runSource(source)] : await runAll();
      console.table(results);
      break;
    }
    case "digest": {
      const r = await sendDigests();
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    case "pipeline": {
      await runDailyPipeline();
      break;
    }
    default:
      console.log("Usage: cli.ts <scrape|digest|pipeline> [--source <name>]");
      process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
