import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { CopyLink } from "@/components/CopyLink";
import { Money } from "@/components/Money";
import { SplitReceipt } from "@/components/SplitReceipt";
import { StatusChip } from "@/components/StatusChip";
import { getOrder, getOrderItems, tryGetSplitSummary } from "@/lib/orders";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId < 1) {
    notFound();
  }
  const db = getDb();
  const order = getOrder(db, orderId);
  if (!order) {
    notFound();
  }
  const items = getOrderItems(db, orderId);
  const split = tryGetSplitSummary(db, orderId);
  const patientTotal = items.reduce((sum, it) => sum + it.unitPriceCents * it.qty, 0);
  const paymentUrl = `/pay/${order.paymentToken}`;

  return (
    <main className="container">
      <header className="page-header">
        <div>
          <span className="kicker">Order</span>
          <h1>
            Order #{order.id} <StatusChip status={order.status} />
          </h1>
          <p className="muted">
            Created {order.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC · channel{" "}
            {order.channel}
            {order.paidAt ? ` · paid ${order.paidAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}
          </p>
        </div>
        <Link className="btn" href="/">
          Dashboard
        </Link>
      </header>

      {split ? (
        <SplitReceipt split={split} />
      ) : (
        <>
          <section className="card">
            <h2>Lines</h2>
            <table className="money-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit price</th>
                  <th className="num">Line total</th>
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
                  <td>Patient total</td>
                  <td />
                  <td />
                  <td className="num">
                    <Money cents={patientTotal} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>
          <section className="card payment-link-card">
            <h2>Payment link (STUB: delivery)</h2>
            <p className="muted">
              Email is out of scope — copy this in-app link and hand it to the patient. It is an
              opaque token; no patient identity is stored.
            </p>
            <CopyLink url={paymentUrl} />
            <p>
              <Link href={paymentUrl}>Open payment page →</Link>
            </p>
          </section>
        </>
      )}
    </main>
  );
}
