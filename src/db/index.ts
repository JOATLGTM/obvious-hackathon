import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

/** Resolve the database file path (override with DB_PATH). */
export function dbFile(): string {
  return process.env.DB_PATH ?? path.join(process.cwd(), "data", "app.db");
}

/** Open (creating parent directories if needed) a Drizzle-over-sqlite3 database. */
export function createDb(file: string): Db {
  if (file !== ":memory:") {
    mkdirSync(path.dirname(file), { recursive: true });
  }
  const sqlite = new Database(file);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

// Module-level singleton; the globalThis guard keeps it stable across dev-server HMR.
const globalForDb = globalThis as unknown as { __supplementOpsDb?: Db };

/** The app's database connection. */
export function getDb(): Db {
  if (!globalForDb.__supplementOpsDb) {
    globalForDb.__supplementOpsDb = createDb(dbFile());
  }
  return globalForDb.__supplementOpsDb;
}
