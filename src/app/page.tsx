import Link from "next/link";
import { getDb } from "@/db";
import { AdjustInventoryForm } from "@/components/AdjustInventoryForm";
import { Money } from "@/components/Money";
import { StatusChip } from "@/components/StatusChip";
import { listInventoryEvents, listOrders, listSupplements, paidTotals } from "@/lib/orders";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const db = getDb();
  const supplements = listSupplements(db);
  const orders = listOrders(db);
  const totals = paidTotals(db);
  const events = listInventoryEvents(db, 8);

  return (
    <main className="container">
      <header className="page-header">
        <div>
          <span className="kicker">Provider console</span>
          <h1>Supplement Ops</h1>
          <p className="muted">In-house ordering and the auditable 75 bps split.</p>
        </div>
        <Link className="btn btn-primary" href="/orders/new">
          New order
        </Link>
      </header>

      <section className="totals-grid" aria-label="Sales totals">
        <div className="card stat">
          <span className="stat-label">Paid orders</span>
          <span className="stat-value">{totals.orderCount}</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Patient paid</span>
          <span className="stat-value">
            <Money cents={totals.paidCents} />
          </span>
        </div>
        <div className="card stat">
          <span className="stat-label">COGS</span>
          <span className="stat-value">
            <Money cents={totals.cogsCents} />
          </span>
        </div>
        <div className="card stat">
          <span className="stat-label">Provider margin</span>
          <span className="stat-value">
            <Money cents={totals.marginCents} />
          </span>
        </div>
        <div className="card stat">
          <span className="stat-label">Platform fee</span>
          <span className="stat-value">
            <Money cents={totals.feeCents} />
          </span>
        </div>
      </section>

      <section className="card">
        <h2>Sold orders</h2>
        {orders.length === 0 ? (
          <div className="empty">No orders yet — build one with “New order”.</div>
        ) : (
          <table className="money-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Status</th>
                <th className="num">Units</th>
                <th className="num">Patient total</th>
                <th className="num">Fee</th>
                <th className="num">Margin</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((row) => (
                <tr key={row.order.id}>
                  <td>
                    <Link href={`/orders/${row.order.id}`}>#{row.order.id}</Link>
                  </td>
                  <td>
                    <StatusChip status={row.order.status} />
                  </td>
                  <td className="num">{row.itemCount}</td>
                  <td className="num">
                    <Money cents={row.patientTotalCents} />
                  </td>
                  <td className="num">
                    {row.feeCents === null ? <span className="muted">—</span> : <Money cents={row.feeCents} />}
                  </td>
                  <td className="num">
                    {row.marginCents === null ? (
                      <span className="muted">—</span>
                    ) : (
                      <Money cents={row.marginCents} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">
          Fee and margin appear once an order is paid and are read from the persisted split — never
          recomputed.
        </p>
      </section>

      <div className="two-col">
        <section className="card">
          <h2>Inventory</h2>
          <table className="money-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th className="num">Unit COGS</th>
                <th className="num">On hand</th>
              </tr>
            </thead>
            <tbody>
              {supplements.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="mono">{s.sku}</td>
                  <td className="num">
                    <Money cents={s.unitCogsCents} />
                  </td>
                  <td className="num">{s.stockOnHand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="stack">
          <section className="card">
            <h2>Manual inventory adjustment</h2>
            <AdjustInventoryForm supplements={supplements.map((s) => ({ id: s.id, name: s.name }))} />
          </section>
          <section className="card">
            <h2>Recent inventory events</h2>
            {events.length === 0 ? (
              <div className="empty">No inventory events yet.</div>
            ) : (
              <ul className="event-list">
                {events.map((e) => (
                  <li key={e.id}>
                    <span className="mono">{e.delta > 0 ? `+${e.delta}` : e.delta}</span>{" "}
                    {e.supplementName} <span className="muted">— {e.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <footer className="app-footer">
        <span>Splits are persisted at capture and never recomputed.</span>
        <span>Payments and link delivery are stubbed · US-only slice</span>
      </footer>
    </main>
  );
}
