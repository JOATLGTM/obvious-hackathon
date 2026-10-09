/**
 * Money helpers. All money in this codebase is integer cents (USD);
 * these helpers are the only place cents meet a string.
 */

/** Format integer cents as a USD string, e.g. 1250 -> "$12.50", -304 -> "-$3.04". */
export function formatMoney(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`formatMoney expects integer cents, got ${cents}`);
  }
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Parse a provider-facing dollar string ("$12.50", "12.5", "12") into integer
 * cents. Returns null for anything that is not a non-negative dollar amount
 * with at most two decimal places.
 */
export function parseDollarsToCents(input: string): number | null {
  const s = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [dollars, frac = ""] = s.split(".");
  const cents = Number(dollars) * 100 + Number((frac + "00").slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}
