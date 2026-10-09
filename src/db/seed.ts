import { sql } from "drizzle-orm";
import type { Db } from "./index";
import { createDb, dbFile } from "./index";
import { orderItems, supplements } from "./schema";

interface SeedRow {
  name: string;
  sku: string;
  unitCogsCents: number;
  suggestedPriceCents: number;
  stockOnHand: number;
}

/** Seeded catalog: plausible supplements, unit COGS in integer cents, stock on hand. */
export const CATALOG: SeedRow[] = [
  { name: "Omega-3 Ultra 1000mg (60 softgels)", sku: "OM3-1000-60", unitCogsCents: 840, suggestedPriceCents: 2400, stockOnHand: 120 },
  { name: "Magnesium Glycinate 400mg (120 caps)", sku: "MG-GLY-400-120", unitCogsCents: 620, suggestedPriceCents: 1899, stockOnHand: 95 },
  { name: "Vitamin D3 5000 IU (90 caps)", sku: "VD3-5000-90", unitCogsCents: 310, suggestedPriceCents: 1200, stockOnHand: 200 },
  { name: "Probiotic Daily 50B CFU (30 caps)", sku: "PROB-50B-30", unitCogsCents: 1450, suggestedPriceCents: 3900, stockOnHand: 60 },
  { name: "Collagen Peptides, Unflavored (16 oz)", sku: "COLL-16OZ", unitCogsCents: 1890, suggestedPriceCents: 4300, stockOnHand: 45 },
  { name: "Turmeric Curcumin 95% (60 caps)", sku: "TURM-95-60", unitCogsCents: 560, suggestedPriceCents: 1699, stockOnHand: 80 },
  { name: "Ashwagandha KSM-66 600mg (60 caps)", sku: "ASHA-K66-60", unitCogsCents: 730, suggestedPriceCents: 2100, stockOnHand: 110 },
  { name: "Zinc Picolinate 25mg (120 caps)", sku: "ZINC-25-120", unitCogsCents: 290, suggestedPriceCents: 999, stockOnHand: 150 },
  { name: "B-Complex Methylated (90 caps)", sku: "BCOMP-ME-90", unitCogsCents: 480, suggestedPriceCents: 1500, stockOnHand: 75 },
  { name: "CoQ10 Ubiquinol 200mg (60 softgels)", sku: "COQ10-200-60", unitCogsCents: 1620, suggestedPriceCents: 4199, stockOnHand: 40 },
];

/**
 * Seed the supplement catalog. Idempotent: skips when the catalog already has
 * rows. `force` reseeds, and refuses while any order references the catalog
 * (reset the database instead — order_items must keep its history).
 */
export function seedCatalog(db: Db, { force = false } = {}): void {
  const existing = db.select({ n: sql<number>`count(*)` }).from(supplements).get()?.n ?? 0;
  if (existing > 0 && !force) {
    console.log(`[seed] catalog already has ${existing} supplements; skipping`);
    return;
  }
  if (force && existing > 0) {
    const referenced = db.select({ n: sql<number>`count(*)` }).from(orderItems).get()?.n ?? 0;
    if (referenced > 0) {
      throw new Error("[seed] --force refused: orders reference this catalog; reset the database instead");
    }
    db.delete(supplements).run();
  }
  for (const row of CATALOG) {
    db.insert(supplements).values(row).run();
  }
  console.log(`[seed] seeded ${CATALOG.length} supplements into ${dbFile()}`);
}

/* Executed as a script via `npm run db:seed`; imported by nothing else. */
if (process.argv[1]?.endsWith("seed.ts")) {
  seedCatalog(createDb(dbFile()), { force: process.argv.includes("--force") });
}
