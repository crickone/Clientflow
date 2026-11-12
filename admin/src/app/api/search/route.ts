import { NextResponse, type NextRequest } from "next/server";

import { api, ApiError } from "@/lib/api";
import type { SearchHit } from "@/lib/types";

/** The palette fetches this; it forwards to the platform API with the staff session. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  try {
    const res = await api<{ hits: SearchHit[] }>(`/search?q=${encodeURIComponent(q)}`);
    return NextResponse.json(res);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    return NextResponse.json({ hits: [] }, { status });
  }
}
