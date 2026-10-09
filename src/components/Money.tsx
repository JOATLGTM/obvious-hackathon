import { formatMoney } from "@/lib/money";

/** Integer-cents money display. Right-align via parent .num styling. */
export function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={`money ${className ?? ""}`}>{formatMoney(cents)}</span>;
}
