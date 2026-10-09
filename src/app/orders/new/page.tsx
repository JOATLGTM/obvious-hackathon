import { getDb } from "@/db";
import { OrderBuilder } from "./OrderBuilder";
import { listSupplements } from "@/lib/orders";

export const dynamic = "force-dynamic";

export default function NewOrderPage() {
  const supplements = listSupplements(getDb());
  return (
    <main className="container">
      <header className="page-header">
        <div>
          <span className="kicker">Order intake</span>
          <h1>Build an order</h1>
          <p className="muted">
            Set the patient-facing price per line. Unit COGS is frozen from the catalog at creation.
          </p>
        </div>
      </header>
      <OrderBuilder
        supplements={supplements.map((s) => ({
          id: s.id,
          name: s.name,
          unitCogsCents: s.unitCogsCents,
          suggestedPriceCents: s.suggestedPriceCents,
          stockOnHand: s.stockOnHand,
        }))}
      />
    </main>
  );
}
