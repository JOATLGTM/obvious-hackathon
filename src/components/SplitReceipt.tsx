import type { SplitReceipt as SplitReceiptData } from "@/lib/orders";
import { formatMoney } from "@/lib/money";
import { Money } from "./Money";

/**
 * The trust surface: the persisted split, per line and in total, readable
 * like a receipt. Values come from split_entries — nothing is recomputed.
 */
export function SplitReceipt({ split }: { split: SplitReceiptData }) {
  return (
    <div className="card receipt">
      <div className="receipt-stamp" aria-hidden="true">
        Paid
      </div>
      <h2>
        Split — where every cent went
        <span className="receipt-sub">Persisted at capture · never recomputed</span>
      </h2>
      <table className="money-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Qty</th>
            <th className="num">Unit</th>
            <th className="num">Paid</th>
            <th className="num">COGS</th>
            <th className="num">Fee</th>
            <th className="num">Margin</th>
          </tr>
        </thead>
        <tbody>
          {split.lines.map((line, i) => (
            <tr key={i}>
              <td>{line.name}</td>
              <td className="num" data-label="Qty">
                {line.qty}
              </td>
              <td className="num" data-label="Unit">
                <Money cents={line.unitPriceCents} />
              </td>
              <td className="num" data-label="Paid">
                <Money cents={line.paidCents} />
              </td>
              <td className="num fee-col" data-label="COGS">
                <Money cents={line.cogsCents} />
              </td>
              <td className="num fee-col" data-label="Fee">
                <Money cents={line.feeCents} />
              </td>
              <td className="num margin-col" data-label="Margin">
                <Money cents={line.marginCents} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td data-label="Totals">Total</td>
            <td data-label="Qty" />
            <td data-label="Unit" />
            <td className="num" data-label="Paid">
              <Money cents={split.totals.paidCents} />
            </td>
            <td className="num fee-col" data-label="COGS">
              <Money cents={split.totals.cogsCents} />
            </td>
            <td className="num fee-col" data-label="Fee">
              <Money cents={split.totals.feeCents} />
            </td>
            <td className="num margin-col" data-label="Margin">
              <Money cents={split.totals.marginCents} />
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="invariant" data-testid="invariant-line">
        {formatMoney(split.totals.cogsCents)} COGS + {formatMoney(split.totals.marginCents)} margin +{" "}
        {formatMoney(split.totals.feeCents)} fee = {formatMoney(split.totals.paidCents)} paid — exact.
      </p>
    </div>
  );
}
