import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { createDb, type Db } from "../db";
import { supplements, type Supplement } from "../db/schema";

/** Drizzle migrations folder at the repo root, resolved from this file. */
export function migrationsFolder(): string {
  return path.resolve(import.meta.dirname, "..", "..", "drizzle");
}

/** Fresh in-memory database with all migrations applied. */
export function testDb(): Db {
  const db = createDb(":memory:");
  migrate(db, { migrationsFolder: migrationsFolder() });
  return db;
}

let skuCounter = 0;

interface SeedOverride {
  name?: string;
  unitCogsCents?: number;
  suggestedPriceCents?: number;
  stockOnHand?: number;
}

/** Insert one catalog row with deterministic defaults and a unique SKU. */
export function seedSupplement(db: Db, over: SeedOverride = {}): Supplement {
  skuCounter += 1;
  const row = {
    name: "Test-a 500mg (60 caps)",
    sku: `TEST-${skuCounter}`,
    unitCogsCents: 500,
    suggestedPriceCents: 1500,
    stockOnHand: 100,
    ...over,
  };
  const inserted = db.insert(supplements).values(row).returning().get();
  if (!inserted) throw new Error("seedSupplement insert returned no row");
  return inserted;
}
