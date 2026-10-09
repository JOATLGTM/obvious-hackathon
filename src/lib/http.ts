import { NextResponse } from "next/server";
import { AppError } from "./errors";

/** Map a thrown error onto an HTTP response. AppErrors are expected outcomes. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[api] unexpected error:", err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
