/**
 * Vercel serverless entrypoint.
 *
 * This catch-all function handles every request under `/api/*`. It simply hands
 * the request to the shared Express app, which mounts all routes under `/api`.
 * The static UI (public/index.html) is served directly by Vercel.
 *
 * Note: the `izsoles` scraper (which needs a headless browser) will not run
 * inside this function — it is executed by the GitHub Actions worker instead.
 * City24/SS scrapes and digests triggered from the API work here.
 */
import app from "../src/server/app.js";

export default app;
