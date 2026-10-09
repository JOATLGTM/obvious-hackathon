import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { ValidationError } from "@/lib/errors";
import { errorResponse } from "@/lib/http";
import { adjustInventory } from "@/lib/orders";

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    throw new ValidationError(`Invalid supplement id: ${raw}`);
  }
  return id;
}

function asInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const delta = asInt(body.delta);
    if (delta === undefined) {
      throw new ValidationError("delta must be a non-zero integer");
    }
    const reason = typeof body.reason === "string" ? body.reason : "";
    const note = typeof body.note === "string" ? body.note : null;
    const result = adjustInventory(getDb(), { supplementId: parseId(id), delta, reason, note });
    return NextResponse.json({ supplement: result.supplement, event: result.event }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
