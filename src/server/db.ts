import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type AppDb = ReturnType<typeof drizzlePg<typeof schema>>;

let pool: Pool | null = null;
let cached: AppDb | null = null;
let cachedUrl: string | null = null;

export function databaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url ? url : null;
}

export function usesNeon(url: string): boolean {
  if (process.env.DB_DRIVER === "pg") return false;
  if (process.env.DB_DRIVER === "neon") return true;
  return url.includes("neon.tech");
}

export function getDb(): AppDb | null {
  const url = databaseUrl();
  if (!url) return null;
  if (cached && cachedUrl === url) return cached;
  cachedUrl = url;
  if (usesNeon(url)) {
    const sql = neon(url);
    cached = drizzleNeon(sql, { schema }) as unknown as AppDb;
    return cached;
  }
  pool = new Pool({ connectionString: url, max: 5 });
  cached = drizzlePg(pool, { schema });
  return cached;
}
