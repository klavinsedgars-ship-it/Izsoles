import "dotenv/config";
import pkg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and configure a Postgres connection string.",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Managed Postgres (Neon/Replit) typically requires SSL; allow self-signed.
  // Local dev connections skip SSL. Opt out explicitly with DB_SSL=false.
  ssl:
    process.env.DB_SSL === "false" ||
    /@(localhost|127\.0\.0\.1|::1)[:/]/.test(process.env.DATABASE_URL)
      ? false
      : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });
export { schema };
