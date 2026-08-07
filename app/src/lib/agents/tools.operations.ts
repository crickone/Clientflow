import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, gte, like, lt, or, sql } from "drizzle-orm";

import { getTenantDbById } from "@/lib/db/tenant";
import { appointments, clients } from "@/lib/db/schema";
import { getSchedulingMode } from "@/lib/settings";
import { clientActivity, listBookings } from "@/lib/attendance";
import { listClients } from "@/lib/queries";
import { sendWhatsApp } from "@/lib/whatsapp/send";

/**
 * Operations-agent tools (Operations Task 1): no-show recovery, lapsed-member
 * re-engagement, and a client-scoped WhatsApp send. `list_no_shows` and
 * `list_lapsed_members` are read tools that branch on `getSchedulingMode()`
 * ("appointments" for clinics, "timetable" for gyms) so the agent works for
 * either venue rather than assuming one. `send_client_whatsapp` is the one
 * NEW write primitive this task adds — it's the sales agent's `send_whatsapp`
 * equivalent but resolves a CLIENT instead of a lead, reusing
 * `@/lib/whatsapp/send`'s existing `subjectType: "client"` support. No new
 * infrastructure: everything else this agent needs (list_classes,
 * list_appointments, get_client, business_overview, send_client_email,
 * reschedule_appointment, book_client_into_class) already exists in
 * `@/lib/assistant/tools` and is reused as-is via the specialist's toolNames.
 *
 * `ToolArtifact`/`ToolResult`/`ToolContext`/`tdb`/`ClientMatch`/
 * `findOneClient`/`clientName` below are deliberately LOCAL, structurally-
 * identical copies of the ones in `@/lib/assistant/tools` rather than imports
 * from it — same circular-dependency reason documented in `tools.sales.ts`:
 * that file imports THIS module's schemas and executors to register them, so
 * importing back from it here would cycle. TypeScript's structural typing
 * makes these interchangeable at every call site.
 *
 * Registered into the central tool registry by `@/lib/assistant/tools`
 * (TOOLS/executeTool/WRITE_TOOLS/summarizeToolAction), exactly like the sales
 * and marketing tools.
 */
type ToolArtifact = { url: string; filename: string; label: string };
export type ToolResult = { text: string; artifact?: ToolArtifact };
export type ToolContext = { tenantId: number; userId?: number };

function tdb(ctx: ToolContext) {
  return getTenantDbById(ctx.tenantId);
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function clientName(row: { firstName: string; lastName: string }): string {
  return `${row.firstName} ${row.lastName}`.trim();
}

type ClientMatch =
  | { id: number; name: string; email: string | null }
  | { ambiguous: string[] }
  | null;

/** Same fuzzy name-match + ambiguity handling as `findOneClient` in `@/lib/assistant/tools`. */
function findOneClient(db: ReturnType<typeof tdb>, name: string): ClientMatch {
  const term = name.trim();
  if (!term) return null;
  const q = `%${term}%`;
  const rows = db
    .select()
    .from(clients)
    .where(
      or(
        like(clients.firstName, q),
        like(clients.lastName, q),
        sql`(${clients.firstName} || ' ' || ${clients.lastName}) LIKE ${q}`,
      ),
    )
    .limit(6)
    .all();
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    const exact = rows.filter((r) => clientName(r).toLowerCase() === term.toLowerCase());
    if (exact.length === 1) return { id: exact[0].id, name: clientName(exact[0]), email: exact[0].email };
    return { ambiguous: rows.map(clientName) };
  }
  return { id: rows[0].id, name: clientName(rows[0]), email: rows[0].email };
}

// ─── Tool schemas (what the model sees) ──────────────────────────────────────

export const OPERATIONS_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_no_shows",
    description:
      "List clients/members whose appointment or class booking was already marked as a no-show by staff, in the last N days. This does NOT mark attendance itself — it only surfaces existing no-shows so you can propose a recovery nudge. Use for 'who no-showed recently'.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "How many days back to look (default 30)." },
      },
    },
  },
  {
    name: "list_lapsed_members",
    description:
      "List clients/members who have gone quiet — had activity before but no appointment or class booking recently. Returns contact details (phone is always on file; email may be missing) so you can propose a win-back message. Use for 'who's lapsed / gone quiet'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "send_client_whatsapp",
    description:
      "Send a WhatsApp text message to a client. ONLY call this when the user has explicitly asked to SEND (not just draft) — show them the exact text first and get a clear go-ahead.",
    input_schema: {
      type: "object",
      properties: {
        clientName: { type: "string", description: "The client's name — used to look them up if clientId isn't already known." },
        clientId: { type: "integer", description: "The client's id, if already known (e.g. from get_client or list_lapsed_members)." },
        text: { type: "string", description: "The message body to send, exactly as it will be sent." },
      },
      required: ["text"],
    },
  },
];

// ─── Executors ───────────────────────────────────────────────────────────────
// Both reads branch on getSchedulingMode() (@/lib/settings), which reads the
// AMBIENT tenant, not ctx — safe because every call site that invokes
// executeTool for a tenant's tools (/api/assistant/chat, /api/assistant/
// execute, /api/agents/[key]/chat) always wraps the call in
// runWithTenant(ctx.tenantId, ...) first, exactly like the sales/marketing
// ambient-tenant tools. Tests must reproduce that wrapping.

/**
 * READ — no-shows already marked by staff in the last `days` days (default
 * 30). Branches on scheduling mode: "appointments" queries the appointments
 * table directly (status="no_show", strictly before today, within the
 * window); "timetable" reuses listBookings' own status filter. Client names
 * are operator-entered data (like list_leads), so this is never fenced.
 */
export function listNoShowsTool(ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  const daysArg = Number(input.days);
  const days = Number.isFinite(daysArg) && daysArg > 0 ? Math.min(365, Math.round(daysArg)) : 30;
  const today = iso(new Date());
  const from = iso(new Date(Date.now() - days * DAY));
  const mode = getSchedulingMode();

  if (mode === "timetable") {
    const rows = listBookings({ from, to: today, status: "no_show" });
    return {
      text: JSON.stringify({
        mode,
        days,
        count: rows.length,
        noShows: rows.map((r) => ({
          clientId: r.clientId,
          clientName: r.clientName,
          sessionName: r.sessionName,
          date: r.sessionDate,
          time: r.startTime,
        })),
      }),
    };
  }

  const db = tdb(ctx);
  const rows = db
    .select()
    .from(appointments)
    .where(and(eq(appointments.status, "no_show"), lt(appointments.date, today), gte(appointments.date, from)))
    .orderBy(desc(appointments.date))
    .all();
  const nameMap = new Map(db.select().from(clients).all().map((c) => [c.id, clientName(c)]));
  return {
    text: JSON.stringify({
      mode,
      days,
      count: rows.length,
      noShows: rows.map((a) => ({
        clientId: a.clientId,
        clientName: nameMap.get(a.clientId) ?? `#${a.clientId}`,
        sessionName: null,
        date: a.date,
        time: a.startTime,
      })),
    }),
  };
}

/**
 * READ — clients/members who have gone quiet. "timetable" reuses
 * clientActivity's own inactive-status filter (has history, none in the last
 * 30 days) then joins clients for phone/email (clientActivity doesn't return
 * contact info). "appointments" reuses listClients({filter:"inactive"}) (no
 * appointment in 90d, per @/lib/queries.ts) and adds each client's last
 * completed-appointment date, mirroring the same "last visit" definition
 * @/lib/queries.ts's getClientStats already uses (status="completed").
 */
export async function listLapsedMembersTool(ctx: ToolContext, _input: Record<string, unknown>): Promise<ToolResult> {
  const today = iso(new Date());
  const mode = getSchedulingMode();

  if (mode === "timetable") {
    const from = iso(new Date(Date.now() - 30 * DAY));
    const rows = clientActivity({ from, today, status: "inactive" });
    const db = tdb(ctx);
    const contactMap = new Map(db.select().from(clients).all().map((c) => [c.id, c]));
    return {
      text: JSON.stringify({
        mode,
        count: rows.length,
        lapsedMembers: rows.map((r) => {
          const c = contactMap.get(r.clientId);
          return {
            clientId: r.clientId,
            clientName: r.name,
            lastSessionDate: r.lastSessionDate,
            phone: c?.phone ?? null,
            email: c?.email ?? null,
          };
        }),
      }),
    };
  }

  const inactive = await listClients({ filter: "inactive" });
  const db = tdb(ctx);
  const lastVisitRows = db
    .select({ clientId: appointments.clientId, lastVisit: sql<string | null>`max(${appointments.date})` })
    .from(appointments)
    .where(eq(appointments.status, "completed"))
    .groupBy(appointments.clientId)
    .all();
  const lastVisitMap = new Map(lastVisitRows.map((r) => [r.clientId, r.lastVisit]));
  return {
    text: JSON.stringify({
      mode,
      count: inactive.length,
      lapsedMembers: inactive.map((c) => ({
        clientId: c.id,
        clientName: clientName(c),
        lastVisitDate: lastVisitMap.get(c.id) ?? null,
        phone: c.phone,
        email: c.email,
      })),
    }),
  };
}

/**
 * WRITE — send a WhatsApp text to a CLIENT (the sales agent's send_whatsapp
 * is lead-scoped; this is the client-scoped equivalent, genuinely reusable by
 * any agent). Resolves clientId directly when given, else fuzzy-matches
 * clientName with the same ambiguity handling as every other write tool.
 * Deferred to the Approve card; never auto-executes (see WRITE_TOOLS in
 * @/lib/assistant/tools).
 */
export async function sendClientWhatsappTool(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const text = String(input.text || "").trim();
  if (!text) return { text: JSON.stringify({ error: "text is required." }) };

  const db = tdb(ctx);
  let clientId: number;
  let name: string;

  const idArg = Number(input.clientId);
  if (Number.isFinite(idArg) && idArg > 0) {
    const row = db.select().from(clients).where(eq(clients.id, idArg)).get();
    if (!row) return { text: JSON.stringify({ error: `No client with id ${idArg}.` }) };
    clientId = row.id;
    name = clientName(row);
  } else {
    const term = String(input.clientName || "").trim();
    if (!term) return { text: JSON.stringify({ error: "Provide clientId or clientName." }) };
    const match = findOneClient(db, term);
    if (!match) return { text: JSON.stringify({ error: `No client matching "${term}".` }) };
    if ("ambiguous" in match) {
      return { text: JSON.stringify({ error: `Multiple clients match: ${match.ambiguous.join(", ")}. Be more specific.` }) };
    }
    clientId = match.id;
    name = match.name;
  }

  try {
    await sendWhatsApp({ subjectType: "client", subjectId: clientId, text, aiGenerated: true });
    return { text: JSON.stringify({ result: `WhatsApp message sent to ${name}.` }) };
  } catch (e) {
    return { text: JSON.stringify({ error: e instanceof Error ? e.message : "Send failed." }) };
  }
}
