import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

// HTTP (one-shot query) driver — ideal for serverless route handlers and
// Inngest steps. Use the pooled (-pooler) connection string in DATABASE_URL.
const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });

export * as schema from "./schema";
