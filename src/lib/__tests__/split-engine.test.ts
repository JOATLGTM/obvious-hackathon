import { describe, expect, it } from "vitest";
import { computeSplit, feeForPaidCents, splitSumsExactly, type SplitLineInput } from "../split-engine";

const line = (unitCogsCents: number, unitPriceCents: number, qty = 1): SplitLineInput => ({
  unitCogsCents,
  unitPriceCents,
  qty,
});

interface Fixture {
  name: string;
  lines: SplitLineInput[];
  expectedPaidCents: number;
  expectedCogsCents: number;
  expectedFeeCents: number;
  expectedMarginCents: number;
}

/**
 * Binding fixtures from the design doc's Money Rules and acceptance
 * criterion 5. Fee = round_half_up(75 bps x extended line total); margin is
 * the derived plug, so the identity cogs + margin + fee == paid holds exactly.
 */
const FIXTURES: Fixture[] = [
  {
    name: "single line",
    lines: [line(500, 1333)],
    expectedPaidCents: 1333,
    expectedCogsCents: 500,
    expectedFeeCents: 10, // round_half_up(9.9975)
    expectedMarginCents: 823,
  },
  {
    name: "multi-item order",
    lines: [line(500, 1333, 2), line(0, 1, 1)],
    expectedPaidCents: 2667,
    expectedCogsCents: 1000,
    expectedFeeCents: 20, // round_half_up(20.0025)
    expectedMarginCents: 1647,
  },
  {
    name: "qty-3 extended-line rounding: 3 x $10.00 pays 23 cents of fee, not 24",
    lines: [line(0, 1000, 3)],
    expectedPaidCents: 3000,
    expectedCogsCents: 0,
    expectedFeeCents: 23, // round_half_up(22.5) — half-up, not banker's, not per-unit
    expectedMarginCents: 2977,
  },
  {
    name: "zero margin (price = cogs + fee)",
    lines: [line(1323, 1333)],
    expectedPaidCents: 1333,
    expectedCogsCents: 1323,
    expectedFeeCents: 10,
    expectedMarginCents: 0,
  },
  {
    name: "below-COGS price: negative margin still sums exact",
    lines: [line(900, 500)],
    expectedPaidCents: 500,
    expectedCogsCents: 900,
    expectedFeeCents: 4, // round_half_up(3.75)
    expectedMarginCents: -404,
  },
  {
    name: "mid-cent fee rounding rounds up",
    lines: [line(0, 133)],
    expectedPaidCents: 133,
    expectedCogsCents: 0,
    expectedFeeCents: 1, // round_half_up(0.9975) = 1, floor would say 0
    expectedMarginCents: 132,
  },
];

describe("split engine fixtures", () => {
  for (const fixture of FIXTURES) {
    it(fixture.name, () => {
      const split = computeSplit(fixture.lines);
      expect(split.totals.paidCents).toBe(fixture.expectedPaidCents);
      expect(split.totals.cogsCents).toBe(fixture.expectedCogsCents);
      expect(split.totals.feeCents).toBe(fixture.expectedFeeCents);
      expect(split.totals.marginCents).toBe(fixture.expectedMarginCents);
      expect(splitSumsExactly(split)).toBe(true);
    });
  }

  it("sum invariant: cogs + margin + fee == paid exactly, per line and per order, on every fixture", () => {
    for (const fixture of FIXTURES) {
      const split = computeSplit(fixture.lines);
      expect(split.totals.cogsCents + split.totals.marginCents + split.totals.feeCents).toBe(
        split.totals.paidCents,
      );
      for (const l of split.lines) {
        expect(l.extendedCogsCents + l.marginCents + l.feeCents).toBe(l.extendedPaidCents);
      }
    }
  });

  it("extended-line fee beats per-unit fee on the canonical example (23, not 3 x 8 = 24)", () => {
    // 3 x $10.00: per-unit rounding would give 3 x feeForPaidCents(1000) = 24.
    expect(feeForPaidCents(1000) * 3).toBe(24);
    expect(computeSplit([line(0, 1000, 3)]).totals.feeCents).toBe(23);
  });

  it("fee boundaries", () => {
    expect(feeForPaidCents(0)).toBe(0);
    expect(feeForPaidCents(1)).toBe(0); // 0.0075 -> 0
    expect(feeForPaidCents(133)).toBe(1); // 0.9975 -> 1 (half-up)
    expect(feeForPaidCents(9999)).toBe(75); // 74.9925 -> 75
    expect(feeForPaidCents(10000)).toBe(75); // exact
    expect(feeForPaidCents(10001)).toBe(75); // 75.0075 -> 75
  });

  it("identity holds across a deterministic pseudo-random sweep", () => {
    // Seeded LCG so failures reproduce.
    let state = 20261009;
    const next = (mod: number) => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state % mod;
    };
    for (let i = 0; i < 200; i++) {
      const split = computeSplit([
        line(next(5000), next(50000), 1 + next(5)),
        line(next(5000), next(50000), 1 + next(3)),
      ]);
      expect(splitSumsExactly(split)).toBe(true);
    }
  });

  it("rejects invalid inputs", () => {
    expect(() => computeSplit([])).toThrow();
    expect(() => computeSplit([line(0, 100, 0)])).toThrow();
    expect(() => computeSplit([line(0, -1)])).toThrow();
    expect(() => feeForPaidCents(-1)).toThrow();
    expect(() => feeForPaidCents(1.5)).toThrow();
  });
});
