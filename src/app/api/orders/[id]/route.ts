import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { errorResponse } from "@/lib/http";
import { getOrder, getOrderItems, tryGetSplitSummary } from "@/lib/orders";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (!Number.isInteger(orderId) || orderId < 1) {
      throw new ValidationError(`Invalid order id: ${id}`);
    }
    const db = getDb();
    const order = getOrder(db, orderId);
    if (!order) {
      throw new NotFoundError(`Order ${orderId} not found`);
    }
    return NextResponse.json({
      order,
      items: getOrderItems(db, orderId),
      split: tryGetSplitSummary(db, orderId),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
