import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schemaImport from "./schema";

export * as schema from "./schema";

// Lazily initialised so importing this module never touches the environment.
// Next's build imports every route module to collect page data; if we read
// DATABASE_URL (or opened a connection) at import time, a secret-free build
// environment (e.g. `docker build`) would crash. The check is deferred to the
// first actual query, which only ever happens at runtime where the var is set.
let _db: NeonHttpDatabase<typeof schemaImport> | null = null;

function getDb(): NeonHttpDatabase<typeof schemaImport> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // HTTP (one-shot query) driver — ideal for serverless route handlers and
  // Inngest steps. Use the pooled (-pooler) connection string in DATABASE_URL.
  _db = drizzle(neon(url), { schema: schemaImport });
  return _db;
}

// A thin proxy so callers keep using `db.select()…` unchanged while the real
// instance is created on first property access.
export const db = new Proxy({} as NeonHttpDatabase<typeof schemaImport>, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
});
