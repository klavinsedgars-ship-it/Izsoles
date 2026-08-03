import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { api } from "./routes.js";

export function createApp() {
  const app = express();
  app.use(express.json());

  app.use("/api", api);
  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Serve the static UI. On Vercel the `public/` folder is served directly by
  // the platform, so this only matters when running as a normal Node server.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), "public"),
    join(here, "..", "..", "public"),
    join(here, "..", "public"),
  ];
  const publicDir = candidates.find((p) => existsSync(p));
  if (publicDir) app.use(express.static(publicDir));

  // JSON error handler — keep API failures as parseable JSON (never an HTML
  // platform error page) so the UI can show a real message.
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error(`[api] ${req.method} ${req.url} ->`, err);
    res.status(500).json({ error: message });
  });

  return app;
}

// A ready-to-use app instance (used by the Vercel serverless entrypoint).
export const app = createApp();
export default app;
