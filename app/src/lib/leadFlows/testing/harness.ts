/**
 * Test support for the lead-flow tests (not a *.test.ts, so the runner never
 * runs it on its own). Require it after ./stubs.
 */
import fs from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";

import { controlSqlite } from "@/lib/db/control";
import { getTenantDbById } from "@/lib/db/tenant";
import * as schema from "@/lib/db/schema";

import { setFlowClockForTests } from "../clock";
import { setFlowTransportForTests, type FlowTransport } from "../transport";

export interface Scratch {
  tid: number;
  slug: string;
  cleanup(): void;
}

/** A throwaway business with its own database. Slugs must end in "-test". */
export function makeScratchTenant(slug: string): Scratch {
  if (!slug.endsWith("-test")) throw new Error("scratch tenant slugs end in -test");
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, slug, `tenants/${slug}/${slug}.db`) as { id: number }).id;
  return {
    tid,
    slug,
    cleanup() {
      setFlowClockForTests(undefined);
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    },
  };
}

export function setFlowEnabled(tid: number, key: string, enabled: boolean): void {
  getTenantDbById(tid)
    .insert(schema.automationTriggers)
    .values({ key, enabled })
    .onConflictDoUpdate({ target: schema.automationTriggers.key, set: { enabled } })
    .run();
}

/** Fix the lead-flow clock at `start`; move it with set/advance. */
export function fakeClock(start: number): { now(): number; set(t: number): void; advance(ms: number): void } {
  let t = start;
  setFlowClockForTests(() => t);
  return {
    now: () => t,
    set(v: number) {
      t = v;
    },
    advance(ms: number) {
      t += ms;
    },
  };
}

export function queueRows(tid: number, leadId: number) {
  return getTenantDbById(tid).select().from(schema.automationQueue).where(eq(schema.automationQueue.leadId, leadId)).all();
}

export interface FakeSend {
  to: "lead" | "number" | "email";
  leadId?: number;
  address?: string;
  text: string;
  subject?: string;
  html?: string;
}

/** Record every send instead of making it. `failWhatsAppFor` makes WhatsApps to those lead ids fail like an undeliverable number. */
export function installFakeTransport(opts: { connected?: boolean } = {}): { sent: FakeSend[]; failWhatsAppFor: Set<number>; restore(): void } {
  const sent: FakeSend[] = [];
  const failWhatsAppFor = new Set<number>();
  let count = 0;
  const fake: FlowTransport = {
    whatsAppConnected: () => opts.connected ?? true,
    async sendWhatsAppToLead(leadId, text) {
      if (failWhatsAppFor.has(leadId)) throw new Error("This number is not on WhatsApp.");
      sent.push({ to: "lead", leadId, text });
      return { providerMessageId: `fake-${++count}` };
    },
    async sendWhatsAppToNumber(phone, text) {
      sent.push({ to: "number", address: phone, text });
      return { providerMessageId: `fake-${++count}` };
    },
    async sendEmail(_tenantId, o) {
      sent.push({ to: "email", address: Array.isArray(o.to) ? o.to.join(",") : o.to, subject: o.subject, html: o.html, text: o.text ?? "" });
      return { ok: true, id: `fake-${++count}` };
    },
  };
  setFlowTransportForTests(fake);
  return { sent, failWhatsAppFor, restore: () => setFlowTransportForTests(undefined) };
}
