import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { ValidationError } from "@/lib/errors";
import { errorResponse } from "@/lib/http";
import { capturePayment } from "@/lib/orders";
import { StubPaymentGateway } from "@/lib/payments";

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    throw new ValidationError(`Invalid order id: ${raw}`);
  }
  return id;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orderId = parseId(id);

    // Body is optional; the only field is the deterministic test control.
    let forceDecline = false;
    const raw = await request.text();
    if (raw) {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new ValidationError("Request body must be valid JSON");
      }
      forceDecline = body.forceDecline === true;
    }

    const result = await capturePayment(getDb(), new StubPaymentGateway(), orderId, { forceDecline });
    if (result.outcome === "captured" || result.outcome === "already_paid") {
      return NextResponse.json({
        status: "paid",
        idempotent: result.outcome === "already_paid",
        split: result.split,
      });
    }
    if (result.outcome === "declined") {
      return NextResponse.json({ status: "declined", reason: result.reason }, { status: 402 });
    }
    return NextResponse.json({ status: "blocked", reason: result.reason }, { status: 409 });
  } catch (err) {
    return errorResponse(err);
  }
}
