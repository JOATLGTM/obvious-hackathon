import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "../db/index";
import {
  inventoryEvents,
  orderItems,
  orders,
  splitEntries,
  supplements,
  type InventoryEvent,
  type Order,
  type OrderItem,
  type Supplement,
} from "../db/schema";
import { CHANNEL_IN_HOUSE, PROVIDER_ID } from "./constants";
import { NotFoundError, ValidationError } from "./errors";
import type { PaymentGateway } from "./payments";
import { computeSplit, splitSumsExactly, type SplitTotals } from "./split-engine";

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export function listSupplements(db: Db): Supplement[] {
  return db.select().from(supplements).orderBy(supplements.name).all();
}

export function getSupplement(db: Db, id: number): Supplement | undefined {
  return db.select().from(supplements).where(eq(supplements.id, id)).get();
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface NewOrderItemInput {
  supplementId: number;
  qty: number;
  unitPriceCents: number;
}

export interface NewOrderInput {
  items: NewOrderItemInput[];
  providerId?: string;
  channel?: string;
}

export interface CreatedOrder {
  order: Order;
  items: OrderItem[];
}

/**
 * Create a draft order. Line prices are set by the provider; unit COGS and the
 * item name are frozen from the catalog at creation. Stock is checked here, at
 * creation time (criterion 6), aggregating duplicate lines per supplement.
 */
export function createOrder(db: Db, input: NewOrderInput): CreatedOrder {
  const items = input.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError("Order must have at least one line item");
  }
  items.forEach((item, i) => {
    if (!Number.isInteger(item.supplementId) || item.supplementId < 1) {
      throw new ValidationError(`Line ${i + 1}: invalid supplementId`);
    }
    if (!Number.isInteger(item.qty) || item.qty < 1) {
      throw new ValidationError(`Line ${i + 1}: qty must be a positive integer`);
    }
    if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
      throw new ValidationError(`Line ${i + 1}: price must be a non-negative integer cent amount`);
    }
  });

  // Aggregate requested qty per supplement so two lines of the same item both
  // count against stock.
  const requested = new Map<number, number>();
  for (const item of items) {
    requested.set(item.supplementId, (requested.get(item.supplementId) ?? 0) + item.qty);
  }
  const catalog = db
    .select()
    .from(supplements)
    .where(inArray(supplements.id, [...requested.keys()]))
    .all();
  const byId = new Map(catalog.map((s) => [s.id, s]));
  for (const [supplementId, qty] of requested) {
    const s = byId.get(supplementId);
    if (!s) {
      throw new ValidationError(`Supplement ${supplementId} does not exist`);
    }
    if (qty > s.stockOnHand) {
      throw new ValidationError(
        `Insufficient stock for ${s.name}: requested ${qty}, on hand ${s.stockOnHand}`,
      );
    }
  }

  const paymentToken = randomUUID();
  return db.transaction((tx) => {
    const order = tx
      .insert(orders)
      .values({
        providerId: input.providerId ?? PROVIDER_ID,
        channel: input.channel ?? CHANNEL_IN_HOUSE,
        paymentToken,
      })
      .returning()
      .get();
    if (!order) throw new Error("order insert returned no row");
    const inserted = items.map((item) => {
      const s = byId.get(item.supplementId)!;
      return tx
        .insert(orderItems)
        .values({
          orderId: order.id,
          supplementId: s.id,
          nameSnapshot: s.name,
          qty: item.qty,
          unitPriceCents: item.unitPriceCents,
          unitCogsCents: s.unitCogsCents,
        })
        .returning()
        .get();
    });
    return { order, items: inserted };
  });
}

export function getOrder(db: Db, id: number): Order | undefined {
  return db.select().from(orders).where(eq(orders.id, id)).get();
}

export function getOrderItems(db: Db, orderId: number): OrderItem[] {
  return db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(orderItems.id)
    .all();
}

export function getOrderByToken(db: Db, token: string): Order | undefined {
  return db.select().from(orders).where(eq(orders.paymentToken, token)).get();
}

// ---------------------------------------------------------------------------
// Split ledger (reads never recompute — the split is what was persisted)
// ---------------------------------------------------------------------------

export interface SplitReceiptLine {
  name: string;
  qty: number;
  unitPriceCents: number;
  paidCents: number;
  cogsCents: number;
  feeCents: number;
  marginCents: number;
}

export interface SplitReceipt {
  lines: SplitReceiptLine[];
  totals: SplitTotals;
}

/** The persisted split for a paid order. Throws NotFoundError if not paid yet. */
export function getSplitSummary(db: Db, orderId: number): SplitReceipt {
  const rows = db
    .select({
      name: orderItems.nameSnapshot,
      qty: orderItems.qty,
      unitPriceCents: orderItems.unitPriceCents,
      paidCents: splitEntries.paidCents,
      cogsCents: splitEntries.cogsCents,
      feeCents: splitEntries.feeCents,
      marginCents: splitEntries.marginCents,
    })
    .from(splitEntries)
    .innerJoin(orderItems, eq(splitEntries.orderItemId, orderItems.id))
    .where(eq(splitEntries.orderId, orderId))
    .orderBy(splitEntries.id)
    .all();
  if (rows.length === 0) {
    throw new NotFoundError(`No split recorded for order ${orderId}`);
  }
  const totals = rows.reduce<SplitTotals>(
    (acc, r) => ({
      paidCents: acc.paidCents + r.paidCents,
      cogsCents: acc.cogsCents + r.cogsCents,
      feeCents: acc.feeCents + r.feeCents,
      marginCents: acc.marginCents + r.marginCents,
    }),
    { paidCents: 0, cogsCents: 0, feeCents: 0, marginCents: 0 },
  );
  return { lines: rows, totals };
}

/** Try to read the persisted split; null when the order is not paid. */
export function tryGetSplitSummary(db: Db, orderId: number): SplitReceipt | null {
  try {
    return getSplitSummary(db, orderId);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Payment capture (idempotent per order)
// ---------------------------------------------------------------------------

export type CaptureOutcome =
  | { outcome: "captured"; split: SplitReceipt }
  | { outcome: "already_paid"; split: SplitReceipt }
  | { outcome: "declined"; reason: string }
  | { outcome: "blocked"; reason: string };

export interface CaptureOptions {
  /** Deterministic test control honored by the stub gateway. */
  forceDecline?: boolean;
}

/**
 * Capture payment for a draft order. The split is computed from frozen line
 * values, charged through the gateway seam, and persisted as immutable
 * per-line split_entries in the same transaction that marks the order paid
 * and decrements stock.
 *
 * Idempotent: if the order is already paid (including a lost race resolved by
 * the conditional update below), the EXISTING split is returned — never a
 * second capture, never a recompute.
 */
export async function capturePayment(
  db: Db,
  gateway: PaymentGateway,
  orderId: number,
  options: CaptureOptions = {},
): Promise<CaptureOutcome> {
  const order = getOrder(db, orderId);
  if (!order) {
    throw new NotFoundError(`Order ${orderId} not found`);
  }
  if (order.status === "paid") {
    return { outcome: "already_paid", split: getSplitSummary(db, orderId) };
  }
  const items = getOrderItems(db, orderId);
  if (items.length === 0) {
    throw new ValidationError(`Order ${orderId} has no line items`);
  }

  // Stock can drift between submission and payment; refuse to charge for
  // anything that cannot ship. Nothing is written on this path.
  for (const item of items) {
    const s = getSupplement(db, item.supplementId);
    if (!s) {
      return { outcome: "blocked", reason: `Supplement ${item.supplementId} no longer exists` };
    }
    if (s.stockOnHand < item.qty) {
      return {
        outcome: "blocked",
        reason: `Insufficient stock for ${s.name}: need ${item.qty}, on hand ${s.stockOnHand}`,
      };
    }
  }

  const split = computeSplit(items);
  if (!splitSumsExactly(split)) {
    // Defense in depth: the engine's identity is tested; this guards refactors.
    throw new Error(`Split identity violated for order ${orderId}; refusing to capture`);
  }

  const gatewayResult = await gateway.capture({
    orderId,
    amountCents: split.totals.paidCents,
    forceDecline: options.forceDecline,
  });
  if (gatewayResult.status === "declined") {
    return { outcome: "declined", reason: gatewayResult.reason };
  }

  // Claim the order with a conditional update so exactly one concurrent
  // capture can win; the loser returns the winner's persisted split.
  const claimed = db.transaction((tx): boolean => {
    const res = tx
      .update(orders)
      .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.status, "draft")))
      .run();
    if (res.changes === 0) return false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const line = split.lines[i]!;
      tx
        .insert(splitEntries)
        .values({
          orderId,
          orderItemId: item.id,
          paidCents: line.extendedPaidCents,
          cogsCents: line.extendedCogsCents,
          feeCents: line.feeCents,
          marginCents: line.marginCents,
        })
        .run();
      tx
        .update(supplements)
        .set({ stockOnHand: sql`${supplements.stockOnHand} - ${item.qty}` })
        .where(eq(supplements.id, item.supplementId))
        .run();
      tx
        .insert(inventoryEvents)
        .values({ supplementId: item.supplementId, orderId, delta: -item.qty, reason: "sale" })
        .run();
    }
    return true;
  });

  if (!claimed) {
    return { outcome: "already_paid", split: getSplitSummary(db, orderId) };
  }
  return { outcome: "captured", split: getSplitSummary(db, orderId) };
}

// ---------------------------------------------------------------------------
// Inventory adjustments
// ---------------------------------------------------------------------------

export interface AdjustInventoryInput {
  supplementId: number;
  delta: number;
  reason: string;
  note?: string | null;
}

/** Apply a manual stock delta and record it as an inventory event. */
export function adjustInventory(
  db: Db,
  input: AdjustInventoryInput,
): { supplement: Supplement; event: InventoryEvent } {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new ValidationError("Delta must be a non-zero integer");
  }
  const reason = input.reason?.trim();
  if (!reason) {
    throw new ValidationError("A reason is required for manual adjustments");
  }
  return db.transaction((tx) => {
    const s = tx.select().from(supplements).where(eq(supplements.id, input.supplementId)).get();
    if (!s) {
      throw new NotFoundError(`Supplement ${input.supplementId} not found`);
    }
    tx
      .update(supplements)
      .set({ stockOnHand: s.stockOnHand + input.delta, updatedAt: new Date() })
      .where(eq(supplements.id, s.id))
      .run();
    const event = tx
      .insert(inventoryEvents)
      .values({
        supplementId: s.id,
        delta: input.delta,
        reason,
        note: input.note?.trim() || null,
      })
      .returning()
      .get();
    if (!event) throw new Error("inventory event insert returned no row");
    return { supplement: { ...s, stockOnHand: s.stockOnHand + input.delta }, event };
  });
}

export function listInventoryEvents(
  db: Db,
  limit = 20,
): (InventoryEvent & { supplementName: string })[] {
  return db
    .select({ event: inventoryEvents, supplementName: supplements.name })
    .from(inventoryEvents)
    .innerJoin(supplements, eq(inventoryEvents.supplementId, supplements.id))
    .orderBy(desc(inventoryEvents.id))
    .limit(limit)
    .all()
    .map((r) => ({ ...r.event, supplementName: r.supplementName }));
}

// ---------------------------------------------------------------------------
// Dashboard views
// ---------------------------------------------------------------------------

export interface OrderListRow {
  order: Order;
  itemCount: number;
  /** Frozen at creation: what the patient was charged (or will be). */
  patientTotalCents: number;
  /** Frozen at creation: what the goods cost the provider. */
  cogsTotalCents: number;
  /** Present only for paid orders, read from the persisted split. */
  feeCents: number | null;
  marginCents: number | null;
}

export function listOrders(db: Db): OrderListRow[] {
  const allOrders = db.select().from(orders).orderBy(desc(orders.id)).all();
  if (allOrders.length === 0) return [];
  const orderIds = new Set(allOrders.map((o) => o.id));
  const items = db
    .select({
      orderId: orderItems.orderId,
      qty: orderItems.qty,
      unitPriceCents: orderItems.unitPriceCents,
      unitCogsCents: orderItems.unitCogsCents,
    })
    .from(orderItems)
    .all();
  const splits = db
    .select({
      orderId: splitEntries.orderId,
      feeCents: splitEntries.feeCents,
      marginCents: splitEntries.marginCents,
    })
    .from(splitEntries)
    .all();

  const itemsByOrder = new Map<number, { qty: number; total: number; cogs: number }>();
  for (const it of items) {
    if (!orderIds.has(it.orderId)) continue;
    const agg = itemsByOrder.get(it.orderId) ?? { qty: 0, total: 0, cogs: 0 };
    agg.qty += it.qty;
    agg.total += it.unitPriceCents * it.qty;
    agg.cogs += it.unitCogsCents * it.qty;
    itemsByOrder.set(it.orderId, agg);
  }
  const splitByOrder = new Map<number, { fee: number; margin: number }>();
  for (const s of splits) {
    const agg = splitByOrder.get(s.orderId) ?? { fee: 0, margin: 0 };
    agg.fee += s.feeCents;
    agg.margin += s.marginCents;
    splitByOrder.set(s.orderId, agg);
  }

  return allOrders.map((order) => {
    const agg = itemsByOrder.get(order.id) ?? { qty: 0, total: 0, cogs: 0 };
    const split = splitByOrder.get(order.id);
    return {
      order,
      itemCount: agg.qty,
      patientTotalCents: agg.total,
      cogsTotalCents: agg.cogs,
      feeCents: split ? split.fee : null,
      marginCents: split ? split.margin : null,
    };
  });
}

export interface PaidTotals {
  orderCount: number;
  paidCents: number;
  cogsCents: number;
  feeCents: number;
  marginCents: number;
}

/** Platform-wide totals over the persisted ledger (split entries exist only for paid orders). */
export function paidTotals(db: Db): PaidTotals {
  const rows = db
    .select({
      orderId: splitEntries.orderId,
      paidCents: splitEntries.paidCents,
      cogsCents: splitEntries.cogsCents,
      feeCents: splitEntries.feeCents,
      marginCents: splitEntries.marginCents,
    })
    .from(splitEntries)
    .all();
  const orderIds = new Set<number>();
  const totals: SplitTotals = { paidCents: 0, cogsCents: 0, feeCents: 0, marginCents: 0 };
  for (const r of rows) {
    orderIds.add(r.orderId);
    totals.paidCents += r.paidCents;
    totals.cogsCents += r.cogsCents;
    totals.feeCents += r.feeCents;
    totals.marginCents += r.marginCents;
  }
  return { orderCount: orderIds.size, ...totals };
}
