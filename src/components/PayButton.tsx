"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Patient-side capture. The decline checkbox exercises the forced-decline
 * path of the stub gateway end to end (order stays unpaid, nothing written).
 */
export function PayButton({ orderId, totalLabel }: { orderId: number; totalLabel: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [forceDecline, setForceDecline] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function pay() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceDecline }),
      });
      const data = (await res.json()) as { status?: string; reason?: string };
      if (res.ok && data.status === "paid") {
        router.push(`/orders/${orderId}`);
        return;
      }
      setMessage(data.reason ?? `Payment failed (${res.status}). Nothing was charged.`);
    } catch {
      setMessage("Network error — nothing was charged.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="pay-controls">
      <button type="button" className="btn btn-primary" onClick={() => pay()} disabled={pending}>
        {pending ? "Processing…" : `Pay ${totalLabel}`}
      </button>
      <label className="check">
        <input
          type="checkbox"
          checked={forceDecline}
          onChange={(e) => setForceDecline(e.target.checked)}
        />
        Simulate declined card
      </label>
      {message && (
        <p className="message error" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
