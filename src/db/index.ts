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

type Db = ReturnType<typeof drizzle<typeof schema>>;
type Pg = InstanceType<typeof Pool>;

let _pool: Pg | undefined;
let _db: Db | undefined;

// Connect lazily. Importing this module must never throw or open a connection —
// otherwise a missing DATABASE_URL would crash the whole serverless function at
// load time and the client would get an opaque HTML error instead of JSON.
function ensure(): { pool: Pg; db: Db } {
  if (_pool && _db) return { pool: _pool, db: _db };
  if (!connectionString) {
    throw new Error(
      "No Postgres connection string is configured. Set DATABASE_URL (or " +
        "POSTGRES_URL) — e.g. connect a database under Vercel → Storage — and redeploy.",
    );
  }
  _pool = new Pool({
    connectionString,
    // Managed Postgres (Vercel/Neon/Supabase) typically requires SSL; allow
    // self-signed. Local dev connections skip SSL. Opt out with DB_SSL=false.
    ssl:
      process.env.DB_SSL === "false" ||
      /@(localhost|127\.0\.0\.1|::1)[:/]/.test(connectionString)
        ? false
        : { rejectUnauthorized: false },
  });
  _db = drizzle(_pool, { schema });
  return { pool: _pool, db: _db };
}

function lazy<T extends object>(pick: () => T): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      const real = pick() as Record<string | symbol, unknown>;
      const value = real[prop];
      return typeof value === "function" ? value.bind(real) : value;
    },
  });
}

// Existing `import { db, pool }` keep working; the connection is opened on first
// actual use, and a missing connection string surfaces as a normal error that
// route handlers turn into a clean JSON 500.
export const db: Db = lazy(() => ensure().db);
export const pool: Pg = lazy(() => ensure().pool);
export { schema };
