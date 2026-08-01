import "dotenv/config";
import { app } from "./app.js";
import { startScheduler } from "../jobs/scheduler.js";

/**
 * Local / long-running-host entrypoint (not used on Vercel).
 * Starts an HTTP listener and the in-process daily scheduler.
 */
const port = Number(process.env.PORT ?? 5000);
app.listen(port, "0.0.0.0", () => {
  console.log(`auction-tracker listening on http://0.0.0.0:${port}`);
  startScheduler();
});
