import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { errorResponse } from "@/lib/http";
import { listSupplements } from "@/lib/orders";

export async function GET() {
  try {
    const db = getDb();
    return NextResponse.json({ supplements: listSupplements(db) });
  } catch (err) {
    return errorResponse(err);
  }
}
