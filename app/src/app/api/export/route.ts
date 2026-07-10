import { NextResponse, type NextRequest } from "next/server";
import { and, gte, lte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatDate, formatEur } from "@/lib/utils";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rows(headers: string[], data: (string | number | null)[][]) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of data) lines.push(row.map(csvEscape).join(","));
  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = req.nextUrl;
  const type = url.searchParams.get("type") ?? "";
  const start = url.searchParams.get("start") ?? "";
  const end = url.searchParams.get("end") ?? "";

  let body = "";
  let filename = `${type}-${start}-${end}.csv`;

  if (type === "appointments") {
    const appts = db
      .select()
      .from(schema.appointments)
      .where(
        and(
          gte(schema.appointments.date, start),
          lte(schema.appointments.date, end),
        ),
      )
      .all();
    const clients = new Map(
      db.select().from(schema.clients).all().map((c) => [c.id, c]),
    );
    const therapyMap = new Map(
      db.select().from(schema.therapies).all().map((t) => [t.id, t]),
    );
    body = rows(
      ["Date", "Time", "Client", "Therapies", "Status", "Price"],
      appts.map((a) => {
        const c = clients.get(a.clientId);
        const tids: number[] = JSON.parse(a.therapyIds || "[]");
        return [
          a.date,
          `${a.startTime}-${a.endTime}`,
          c ? `${c.firstName} ${c.lastName}` : "—",
          tids.map((id) => therapyMap.get(id)?.name ?? "").filter(Boolean).join(" / "),
          a.status,
          a.totalPriceEur,
        ];
      }),
    );
  } else if (type === "clients") {
    const all = db.select().from(schema.clients).all();
    body = rows(
      [
        "Name",
        "Email",
        "Phone",
        "Date of birth",
        "GDPR consent",
        "Created",
      ],
      all.map((c) => [
        `${c.firstName} ${c.lastName}`,
        c.email ?? "",
        c.phone,
        c.dateOfBirth ?? "",
        c.gdprConsent ? "yes" : "no",
        formatDate(c.createdAt),
      ]),
    );
    filename = `clients.csv`;
  } else if (type === "revenue") {
    const series = db
      .select({
        day: sql<string>`date(${schema.payments.createdAt} / 1000, 'unixepoch')`,
        method: schema.payments.paymentMethod,
        total: sql<number>`coalesce(sum(${schema.payments.amountEur}),0)`,
      })
      .from(schema.payments)
      .where(
        sql`date(${schema.payments.createdAt} / 1000, 'unixepoch') BETWEEN ${start} AND ${end}`,
      )
      .groupBy(
        sql`date(${schema.payments.createdAt} / 1000, 'unixepoch')`,
        schema.payments.paymentMethod,
      )
      .all();
    body = rows(
      ["Date", "Payment method", "Total"],
      series.map((r) => [r.day, r.method, formatEur(r.total)]),
    );
  } else {
    return new Response("Unknown type", { status: 400 });
  }

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
