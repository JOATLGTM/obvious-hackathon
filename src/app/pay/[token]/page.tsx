import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { Money } from "@/components/Money";
import { PayButton } from "@/components/PayButton";
import { formatMoney } from "@/lib/money";
import { getOrderByToken, getOrderItems } from "@/lib/orders";

export const dynamic = "force-dynamic";

export default async function PatientPayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const order = getOrderByToken(db, token);
  if (!order) {
    notFound();
  }
  const items = getOrderItems(db, order.id);
  const total = items.reduce((sum, it) => sum + it.unitPriceCents * it.qty, 0);

  if (order.status === "paid") {
    return (
      <main className="container narrow">
        <div className="card">
          <h1>Already paid — thank you.</h1>
          <p className="muted">
            Payment for order #{order.id} was already captured; the split is recorded and immutable.
          </p>
          <p>
            <Link href={`/orders/${order.id}`}>View the receipt →</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="container narrow">
      <div className="card">
        <h1>Pay your supplement order</h1>
        <p className="muted">Order #{order.id} from your provider.</p>
        <table className="money-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Qty</th>
              <th className="num">Unit</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{it.nameSnapshot}</td>
                <td className="num">{it.qty}</td>
                <td className="num">
                  <Money cents={it.unitPriceCents} />
                </td>
                <td className="num">
                  <Money cents={it.unitPriceCents * it.qty} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Amount due</td>
              <td />
              <td />
              <td className="num">
                <Money cents={total} />
              </td>
            </tr>
          </tfoot>
        </table>
        <PayButton orderId={order.id} totalLabel={formatMoney(total)} />
        <p className="muted small">
          STUB: payments run through a fake gateway — no card is collected and no real charge is
          made. A declined simulation writes nothing.
        </p>
      </div>
    </main>
  );
}
