/**
 * The split engine — the load-bearing math of the slice.
 *
 * Money rules (design doc, binding):
 * - All money is integer cents. No floats.
 * - Per line: extended paid = unit_price x qty; extended cogs = unit_cogs x qty.
 * - Platform fee = 75 bps of the extended paid amount, rounded half-up.
 * - Provider margin = extended paid - extended cogs - fee (the derived plug).
 * - Therefore cogs + margin + fee == paid exactly on every line, and for
 *   every order. There is no residual bucket to allocate.
 *
 * Fee rounding uses pure integer arithmetic: round_half_up(75 * paid / 10000)
 * is floor((75*paid + 5000) / 10000) for non-negative paid. No float ever
 * touches the computation.
 */

export const FEE_BASIS_POINTS = 75;

export interface SplitLineInput {
  qty: number;
  unitPriceCents: number;
  unitCogsCents: number;
}

export interface SplitLine {
  qty: number;
  unitPriceCents: number;
  unitCogsCents: number;
  extendedPaidCents: number;
  extendedCogsCents: number;
  feeCents: number;
  marginCents: number;
}

export interface SplitTotals {
  paidCents: number;
  cogsCents: number;
  feeCents: number;
  marginCents: number;
}

export interface Split {
  lines: SplitLine[];
  totals: SplitTotals;
}

/** 75 bps of `paidCents`, rounded half-up, integer math only. */
export function feeForPaidCents(paidCents: number): number {
  if (!Number.isInteger(paidCents) || paidCents < 0) {
    throw new Error(`feeForPaidCents expects non-negative integer cents, got ${paidCents}`);
  }
  return Math.floor((FEE_BASIS_POINTS * paidCents + 5000) / 10000);
}

export function computeSplitLine(input: SplitLineInput): SplitLine {
  const { qty, unitPriceCents, unitCogsCents } = input;
  if (!Number.isInteger(qty) || qty < 1) {
    throw new Error(`qty must be a positive integer, got ${qty}`);
  }
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
    throw new Error(`unitPriceCents must be a non-negative integer, got ${unitPriceCents}`);
  }
  if (!Number.isInteger(unitCogsCents) || unitCogsCents < 0) {
    throw new Error(`unitCogsCents must be a non-negative integer, got ${unitCogsCents}`);
  }
  const extendedPaidCents = unitPriceCents * qty;
  const extendedCogsCents = unitCogsCents * qty;
  const feeCents = feeForPaidCents(extendedPaidCents);
  const marginCents = extendedPaidCents - extendedCogsCents - feeCents;
  return {
    qty,
    unitPriceCents,
    unitCogsCents,
    extendedPaidCents,
    extendedCogsCents,
    feeCents,
    marginCents,
  };
}

/** Compute the full split for an order's lines. Pure; persists nothing. */
export function computeSplit(inputs: SplitLineInput[]): Split {
  if (inputs.length === 0) {
    throw new Error("computeSplit requires at least one line");
  }
  const lines = inputs.map(computeSplitLine);
  const totals = lines.reduce<SplitTotals>(
    (acc, l) => ({
      paidCents: acc.paidCents + l.extendedPaidCents,
      cogsCents: acc.cogsCents + l.extendedCogsCents,
      feeCents: acc.feeCents + l.feeCents,
      marginCents: acc.marginCents + l.marginCents,
    }),
    { paidCents: 0, cogsCents: 0, feeCents: 0, marginCents: 0 },
  );
  return { lines, totals };
}

/** The audit invariant: cogs + margin + fee must equal patient paid, exactly. */
export function splitSumsExactly(split: Split): boolean {
  const { paidCents, cogsCents, feeCents, marginCents } = split.totals;
  return cogsCents + marginCents + feeCents === paidCents;
}
