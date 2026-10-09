import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { inventoryEvents, orderItems, orders, splitEntries, supplements } from "../../db/schema";
import type { Db } from "../../db";
import { seedSupplement, testDb } from "../../test/helpers";
import {
  adjustInventory,
  capturePayment,
  createOrder,
  getOrderItems,
  getOrderByToken,
  getSplitSummary,
  listOrders,
  paidTotals,
  type CaptureOutcome,
  type SplitReceipt,
} from "../orders";
import { StubPaymentGateway } from "../payments";

const gateway = new StubPaymentGateway();

type SplitOutcome = Extract<CaptureOutcome, { split: SplitReceipt }>;

/** Assert the capture outcome and narrow to the variants that carry a split. */
function expectCaptured(result: CaptureOutcome, outcome: "captured" | "already_paid"): SplitOutcome {
  expect(result.outcome).toBe(outcome);
  if (!("split" in result)) {
    throw new Error(`expected outcome "${outcome}", got "${result.outcome}" — no split written`);
  }
  return result;
}

function count(db: Db, table: typeof splitEntries | typeof inventoryEvents | typeof orders | typeof orderItems): number {
  return db.select({ id: table.id }).from(table).all().length;
}

describe("createOrder", () => {
  it("freezes name, unit price, and unit COGS on the line at creation", () => {
    const db = testDb();
    const s = seedSupplement(db, { name: "Magnesium 400mg", unitCogsCents: 620, suggestedPriceCents: 1899 });
    const created = createOrder(db, { items: [{ supplementId: s.id, qty: 2, unitPriceCents: 2500 }] });
    const [item] = getOrderItems(db, created.order.id);
    expect(item).toMatchObject({
      supplementId: s.id,
      nameSnapshot: "Magnesium 400mg",
      qty: 2,
      unitPriceCents: 2500, // provider-set, not the suggested price
      unitCogsCents: 620, // frozen from catalog
    });
  });

  it("blocks creation when requested quantity exceeds stock on hand (criterion 6)", () => {
    const db = testDb();
    const s = seedSupplement(db, { stockOnHand: 2 });
    expect(() =>
      createOrder(db, { items: [{ supplementId: s.id, qty: 3, unitPriceCents: 1000 }] }),
    ).toThrow(/Insufficient stock/);
    expect(count(db, orders)).toBe(0);
  });

  it("aggregates duplicate lines of the same supplement against stock", () => {
    const db = testDb();
    const s = seedSupplement(db, { stockOnHand: 3 });
    expect(() =>
      createOrder(db, {
        items: [
          { supplementId: s.id, qty: 2, unitPriceCents: 1000 },
          { supplementId: s.id, qty: 2, unitPriceCents: 1000 },
        ],
      }),
    ).toThrow(/Insufficient stock/);
    expect(count(db, orders)).toBe(0);
  });

  it("rejects empty items, unknown supplements, and invalid quantities or prices", () => {
    const db = testDb();
    const s = seedSupplement(db);
    expect(() => createOrder(db, { items: [] })).toThrow();
    expect(() => createOrder(db, { items: [{ supplementId: s.id + 999, qty: 1, unitPriceCents: 100 }] })).toThrow();
    expect(() => createOrder(db, { items: [{ supplementId: s.id, qty: 0, unitPriceCents: 100 }] })).toThrow();
    expect(() => createOrder(db, { items: [{ supplementId: s.id, qty: 1, unitPriceCents: 10.5 }] })).toThrow();
  });
});

describe("capturePayment", () => {
  it("persists one split entry per line, decrements stock, and records sale events", async () => {
    const db = testDb();
    const a = seedSupplement(db, { unitCogsCents: 500, stockOnHand: 10 });
    const b = seedSupplement(db, { unitCogsCents: 0, stockOnHand: 10 });
    const created = createOrder(db, {
      items: [
        { supplementId: a.id, qty: 1, unitPriceCents: 1333 },
        { supplementId: b.id, qty: 3, unitPriceCents: 1000 },
      ],
    });
    const result = expectCaptured(await capturePayment(db, gateway, created.order.id), "captured");
    expect(result.split.totals).toEqual({ paidCents: 4333, cogsCents: 500, feeCents: 33, marginCents: 3800 });

    const entries = db.select().from(splitEntries).all();
    expect(entries).toHaveLength(2); // one per line
    const aStock = db.select().from(supplements).where(eq(supplements.id, a.id)).get()!;
    const bStock = db.select().from(supplements).where(eq(supplements.id, b.id)).get()!;
    expect(aStock.stockOnHand).toBe(9);
    expect(bStock.stockOnHand).toBe(7);
    const events = db.select().from(inventoryEvents).all();
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.reason).toBe("sale");
      expect(e.delta).toBeLessThan(0);
      expect(e.orderId).toBe(created.order.id);
    }
  });

  it("is idempotent: double capture returns the existing split and writes nothing new", async () => {
    const db = testDb();
    const s = seedSupplement(db, { stockOnHand: 10 });
    const created = createOrder(db, { items: [{ supplementId: s.id, qty: 1, unitPriceCents: 1333 }] });
    const first = expectCaptured(await capturePayment(db, gateway, created.order.id), "captured");
    const entriesAfterFirst = count(db, splitEntries);

    const second = expectCaptured(await capturePayment(db, gateway, created.order.id), "already_paid");
    expect(second.split.totals).toEqual(first.split.totals);
    expect(count(db, splitEntries)).toBe(entriesAfterFirst);
    expect(count(db, inventoryEvents)).toBe(1);
  });

  it("forced decline writes nothing; a retry then succeeds with exactly one split", async () => {
    const db = testDb();
    const s = seedSupplement(db, { stockOnHand: 10 });
    const created = createOrder(db, { items: [{ supplementId: s.id, qty: 2, unitPriceCents: 1000 }] });

    const declined = await capturePayment(db, gateway, created.order.id, { forceDecline: true });
    expect(declined.outcome).toBe("declined");
    const stillDraft = db.select().from(orders).where(eq(orders.id, created.order.id)).get()!;
    expect(stillDraft.status).toBe("draft");
    expect(count(db, splitEntries)).toBe(0);
    expect(count(db, inventoryEvents)).toBe(0);
    const stockAfterDecline = db.select().from(supplements).where(eq(supplements.id, s.id)).get()!;
    expect(stockAfterDecline.stockOnHand).toBe(10);

    const retry = expectCaptured(await capturePayment(db, gateway, created.order.id), "captured");
    expect(count(db, splitEntries)).toBe(1);
    expect(retry.split.totals.paidCents).toBe(2000);
  });

  it("refuses to charge when stock drifted below the order after creation, then succeeds after restock", async () => {
    const db = testDb();
    const s = seedSupplement(db, { stockOnHand: 5 });
    const created = createOrder(db, { items: [{ supplementId: s.id, qty: 2, unitPriceCents: 1000 }] });
    adjustInventory(db, { supplementId: s.id, delta: -4, reason: "damage" });

    const blocked = await capturePayment(db, gateway, created.order.id);
    expect(blocked.outcome).toBe("blocked");
    expect(count(db, splitEntries)).toBe(0);
    expect(db.select().from(orders).where(eq(orders.id, created.order.id)).get()!.status).toBe("draft");

    adjustInventory(db, { supplementId: s.id, delta: 2, reason: "restock" });
    const retry = await capturePayment(db, gateway, created.order.id);
    expect(retry.outcome).toBe("captured");
  });
});

describe("split immutability", () => {
  it("catalog price and COGS edits after payment leave the recorded split unchanged", async () => {
    const db = testDb();
    const s = seedSupplement(db, { unitCogsCents: 500, suggestedPriceCents: 2000 });
    const created = createOrder(db, { items: [{ supplementId: s.id, qty: 2, unitPriceCents: 2500 }] });
    const before = expectCaptured(await capturePayment(db, gateway, created.order.id), "captured");
    const snapshot = before.split;

    // Rewrite the catalog: price, COGS, even the name.
    db.update(supplements)
      .set({ unitCogsCents: 999, suggestedPriceCents: 1, name: "Renamed After Payment" })
      .where(eq(supplements.id, s.id))
      .run();

    const after = getSplitSummary(db, created.order.id);
    expect(after).toEqual(snapshot);
    const [item] = getOrderItems(db, created.order.id);
    expect(item.unitPriceCents).toBe(2500);
    expect(item.unitCogsCents).toBe(500);
    expect(item.nameSnapshot).not.toBe("Renamed After Payment");
  });

  it("the ledger sums exactly for every captured fixture", async () => {
    const cases: Array<{ unitCogsCents: number; unitPriceCents: number; qty: number }> = [
      { unitCogsCents: 500, unitPriceCents: 1333, qty: 1 },
      { unitCogsCents: 0, unitPriceCents: 1000, qty: 3 },
      { unitCogsCents: 900, unitPriceCents: 500, qty: 2 },
      { unitCogsCents: 1233, unitPriceCents: 1333, qty: 1 },
    ];
    for (const c of cases) {
      const db = testDb();
      const s = seedSupplement(db, { unitCogsCents: c.unitCogsCents, stockOnHand: 100 });
      const created = createOrder(db, { items: [{ supplementId: s.id, qty: c.qty, unitPriceCents: c.unitPriceCents }] });
      const result = await capturePayment(db, gateway, created.order.id);
      expect(result.outcome).toBe("captured");
      const t = getSplitSummary(db, created.order.id).totals;
      expect(t.cogsCents + t.marginCents + t.feeCents).toBe(t.paidCents);
      expect(t.paidCents).toBe(c.unitPriceCents * c.qty);
    }
  });
});

describe("inventory adjustments", () => {
  it("records a manual adjustment as an inventory event with delta, reason, and timestamp", () => {
    const db = testDb();
    const s = seedSupplement(db, { stockOnHand: 50 });
    const { supplement, event } = adjustInventory(db, {
      supplementId: s.id,
      delta: 24,
      reason: "restock",
      note: "PO #12",
    });
    expect(supplement.stockOnHand).toBe(74);
    expect(event).toMatchObject({ supplementId: s.id, delta: 24, reason: "restock", note: "PO #12" });
    expect(event.createdAt).toBeInstanceOf(Date);
  });

  it("validates delta, reason, and supplement existence", () => {
    const db = testDb();
    const s = seedSupplement(db);
    expect(() => adjustInventory(db, { supplementId: s.id, delta: 0, reason: "restock" })).toThrow();
    expect(() => adjustInventory(db, { supplementId: s.id, delta: 5, reason: "  " })).toThrow();
    expect(() => adjustInventory(db, { supplementId: s.id + 42, delta: 5, reason: "restock" })).toThrow();
  });
});

describe("dashboard views", () => {
  it("lists orders with frozen totals and split-derived fee/margin, and aggregates platform totals", async () => {
    const db = testDb();
    const s = seedSupplement(db, { unitCogsCents: 500, stockOnHand: 100 });
    const draft = createOrder(db, { items: [{ supplementId: s.id, qty: 1, unitPriceCents: 2000 }] });
    const paid = createOrder(db, { items: [{ supplementId: s.id, qty: 3, unitPriceCents: 1000 }] });
    await capturePayment(db, gateway, paid.order.id);

    const rows = listOrders(db);
    expect(rows).toHaveLength(2);
    const draftRow = rows.find((r) => r.order.id === draft.order.id)!;
    expect(draftRow.order.status).toBe("draft");
    expect(draftRow.patientTotalCents).toBe(2000);
    expect(draftRow.feeCents).toBeNull();
    const paidRow = rows.find((r) => r.order.id === paid.order.id)!;
    expect(paidRow.order.status).toBe("paid");
    expect(paidRow.patientTotalCents).toBe(3000);
    expect(paidRow.feeCents).not.toBeNull();

    const totals = paidTotals(db);
    expect(totals.orderCount).toBe(1);
    expect(totals.paidCents).toBe(3000);
    expect(totals.cogsCents).toBe(1500);
    expect(totals.feeCents).toBe(23); // 3 x $10 extended line -> 23 (half-up)
    expect(totals.marginCents).toBe(1477);
  });
});

describe("opaque token", () => {
  it("resolves orders by payment token and stores no patient identity", async () => {
    const db = testDb();
    const s = seedSupplement(db);
    const created = createOrder(db, { items: [{ supplementId: s.id, qty: 1, unitPriceCents: 1200 }] });
    expect(created.order.paymentToken).toMatch(/^[0-9a-f-]{36}$/);
    const byToken = getOrderByToken(db, created.order.paymentToken);
    expect(byToken?.id).toBe(created.order.id);
    expect(Object.keys(created.order)).not.toContain("patientName");
  });
});
