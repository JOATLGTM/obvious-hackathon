import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { ValidationError } from "@/lib/errors";
import { errorResponse } from "@/lib/http";
import { createOrder, type NewOrderItemInput } from "@/lib/orders";

function asInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function parseItems(raw: unknown): NewOrderItemInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError("items must be a non-empty array");
  }
  return raw.map((entry, i) => {
    const it = (entry ?? {}) as Record<string, unknown>;
    const supplementId = asInt(it.supplementId);
    const qty = asInt(it.qty);
    const unitPriceCents = asInt(it.unitPriceCents);
    if (supplementId === undefined) {
      throw new ValidationError(`Line ${i + 1}: supplementId must be an integer`);
    }
    if (qty === undefined) {
      throw new ValidationError(`Line ${i + 1}: qty must be an integer`);
    }
    if (unitPriceCents === undefined) {
      throw new ValidationError(`Line ${i + 1}: unitPriceCents must be an integer`);
    }
    return { supplementId, qty, unitPriceCents };
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const created = createOrder(getDb(), { items: parseItems(body.items) });
    return NextResponse.json(
      { order: created.order, items: created.items, paymentUrl: `/pay/${created.order.paymentToken}` },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
