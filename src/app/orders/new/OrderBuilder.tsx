"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseDollarsToCents } from "@/lib/money";

interface SupplementOption {
  id: number;
  name: string;
  unitCogsCents: number;
  suggestedPriceCents: number;
  stockOnHand: number;
}

interface Line {
  supplementId: number;
  qty: string;
  price: string;
}

function formatSuggested(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function OrderBuilder({ supplements }: { supplements: SupplementOption[] }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(supplements.length > 0 ? [{ supplementId: supplements[0]!.id, qty: "1", price: formatSuggested(supplements[0]!.suggestedPriceCents) }] : []);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function updateLine(index: number, patch: Partial<Line>) {
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    const first = supplements[0];
    if (!first) return;
    setLines([...lines, { supplementId: first.id, qty: "1", price: formatSuggested(first.suggestedPriceCents) }]);
  }

  function removeLine(index: number) {
    setLines(lines.filter((_, i) => i !== index));
  }

  const previewTotal = lines.reduce((sum, line) => {
    const cents = parseDollarsToCents(line.price);
    const qty = Number(line.qty);
    return cents !== null && Number.isInteger(qty) && qty > 0 ? sum + cents * qty : sum;
  }, 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const items = lines.map((line) => ({
        supplementId: line.supplementId,
        qty: Number(line.qty),
        unitPriceCents: parseDollarsToCents(line.price) ?? -1,
      }));
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = (await res.json()) as { order?: { id: number }; error?: string };
      if (!res.ok || !data.order) {
        setError(data.error ?? `Order could not be created (${res.status}).`);
        return;
      }
      router.push(`/orders/${data.order.id}`);
    } catch {
      setError("Network error — order not saved.");
    } finally {
      setPending(false);
    }
  }

  if (supplements.length === 0) {
    return (
      <div className="card">
        <p className="muted">The catalog is empty — run `npm run db:seed` and reload.</p>
      </div>
    );
  }

  return (
    <form className="card builder" onSubmit={(e) => submit(e)}>
      {lines.map((line, i) => {
        return (
          <div className="line-row" key={i}>
            <label>
              Supplement
              <select
                value={line.supplementId}
                onChange={(e) => updateLine(i, { supplementId: Number(e.target.value) })}
              >
                {supplements.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} — COGS {formatSuggested(x.unitCogsCents)}, on hand {x.stockOnHand}
                  </option>
                ))}
              </select>
            </label>
            <label className="qty">
              Qty
              <input
                type="number"
                min={1}
                value={line.qty}
                onChange={(e) => updateLine(i, { qty: e.target.value })}
                required
              />
            </label>
            <label className="price">
              Patient price
              <input
                type="text"
                inputMode="decimal"
                value={line.price}
                onChange={(e) => updateLine(i, { price: e.target.value })}
                required
              />
            </label>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => removeLine(i)}
              disabled={lines.length === 1}
              aria-label="Remove line"
            >
              ✕
            </button>
          </div>
        );
      })}
      <div className="builder-actions">
        <button type="button" className="btn" onClick={addLine}>
          Add line
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Creating…" : "Create order"}
        </button>
        <span className="total-preview">
          Patient total: <strong>${(previewTotal / 100).toFixed(2)}</strong>
        </span>
      </div>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
