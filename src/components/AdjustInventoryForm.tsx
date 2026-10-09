"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Option {
  id: number;
  name: string;
}

const REASONS = ["restock", "correction", "damage", "other"];

/** Manual stock adjustment; every adjustment is recorded as an inventory event. */
export function AdjustInventoryForm({ supplements }: { supplements: Option[] }) {
  const router = useRouter();
  const [supplementId, setSupplementId] = useState(supplements[0]?.id ?? 0);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState(REASONS[0]!);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (supplements.length === 0) {
    return <p className="muted">Seed the catalog first — nothing to adjust.</p>;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/supplements/${supplementId}/inventory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta: Number(delta), reason, note: note || null }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Adjustment failed (${res.status}).`);
        return;
      }
      setDelta("");
      setNote("");
      router.refresh();
    } catch {
      setError("Network error — adjustment not saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="adjust-form" onSubmit={(e) => submit(e)}>
      <label>
        Supplement
        <select
          value={supplementId}
          onChange={(e) => setSupplementId(Number(e.target.value))}
        >
          {supplements.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Change in units (+/−)
        <input
          type="number"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          placeholder="e.g. 24 or -2"
          required
        />
      </label>
      <label>
        Reason
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label>
        Note (optional)
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="submit" className="btn" disabled={pending || delta === ""}>
        {pending ? "Saving…" : "Adjust"}
      </button>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
