import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const __auth = await guard("admin");
  if (__auth) return __auth;
  const rows = db.select().from(schema.clients).all();
  return NextResponse.json(rows);
}
