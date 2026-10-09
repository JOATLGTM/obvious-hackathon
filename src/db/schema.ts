import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Money columns are integers: US dollars in cents. Floats never touch money.
 * `unit_price_cents` and `unit_cogs_cents` on order_items are frozen at order
 * creation; later catalog edits cannot rewrite what an order captured.
 */

export const supplements = sqliteTable("supplements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(),
  unitCogsCents: integer("unit_cogs_cents").notNull(),
  suggestedPriceCents: integer("suggested_price_cents").notNull(),
  stockOnHand: integer("stock_on_hand").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Auth is stubbed: every order belongs to the demo provider (see lib/constants).
  providerId: text("provider_id").notNull(),
  status: text("status", { enum: ["draft", "paid"] })
    .notNull()
    .default("draft"),
  channel: text("channel").notNull().default("in_house"),
  // Opaque token for the in-app patient payment link; no patient identity stored.
  paymentToken: text("payment_token").notNull().unique(),
  paidAt: integer("paid_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const orderItems = sqliteTable("order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id),
  supplementId: integer("supplement_id")
    .notNull()
    .references(() => supplements.id),
  // Name frozen at creation so a later catalog rename cannot alter the receipt.
  nameSnapshot: text("name_snapshot").notNull(),
  qty: integer("qty").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  unitCogsCents: integer("unit_cogs_cents").notNull(),
});

// Written once at capture, never updated. One entry per order line
// (unique order_item_id); reads recompute nothing.
export const splitEntries = sqliteTable("split_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id),
  orderItemId: integer("order_item_id")
    .notNull()
    .references(() => orderItems.id)
    .unique(),
  paidCents: integer("paid_cents").notNull(),
  cogsCents: integer("cogs_cents").notNull(),
  marginCents: integer("margin_cents").notNull(),
  feeCents: integer("fee_cents").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const inventoryEvents = sqliteTable("inventory_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  supplementId: integer("supplement_id")
    .notNull()
    .references(() => supplements.id),
  // Set for sale events; null for manual adjustments.
  orderId: integer("order_id").references(() => orders.id),
  delta: integer("delta").notNull(),
  // "sale" | "manual_adjustment" (free-text reasons allowed for manual entries)
  reason: text("reason").notNull(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type Supplement = typeof supplements.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type SplitEntry = typeof splitEntries.$inferSelect;
export type InventoryEvent = typeof inventoryEvents.$inferSelect;
