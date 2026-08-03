import "dotenv/config";
import pkg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const { Pool } = pkg;

// Accept whatever a hosted Postgres provider injects. Vercel Postgres / Neon
// add DATABASE_URL and/or POSTGRES_URL(_*); Supabase adds POSTGRES_URL. Prefer
// a pooled connection string for serverless.
const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL_UNPOOLED;

if (!connectionString) {
  throw new Error(
    "No Postgres connection string found. Set DATABASE_URL (or POSTGRES_URL). " +
      "Copy .env.example to .env for local development.",
  );
}

export const pool = new Pool({
  connectionString,
  // Managed Postgres (Vercel/Neon/Supabase) typically requires SSL; allow
  // self-signed. Local dev connections skip SSL. Opt out with DB_SSL=false.
  ssl:
    process.env.DB_SSL === "false" ||
    /@(localhost|127\.0\.0\.1|::1)[:/]/.test(connectionString)
      ? false
      : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });
export { schema };
