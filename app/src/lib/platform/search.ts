import "server-only";

import { controlSqlite } from "@/lib/db/control";

/**
 * One search box for the console. Four things a platform operator looks
 * for: a business (name or slug), a person (email or name, any business),
 * a domain, an invoice (#id or gateway reference). Everything comes from
 * the control plane, so it is one process and a few indexed LIKEs; nothing
 * opens a tenant database. Returns console paths, never raw records.
 */
export type SearchHit =
  | { kind: "business"; id: number; title: string; subtitle: string; href: string }
  | { kind: "person"; id: number; title: string; subtitle: string; href: string; tenantId: number }
  | { kind: "domain"; id: number; title: string; subtitle: string; href: string; tenantId: number }
  | { kind: "invoice"; id: number; title: string; subtitle: string; href: string; tenantId: number };

export function searchPlatform(raw: string, limit = 12): SearchHit[] {
  const q = raw.trim().toLowerCase();
  if (q.length < 2) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const esc = (v: string) => v.replace(/[\\%_]/g, (c) => "\\" + c);
  const likes = words.map((w) => `%${esc(w)}%`);
  const qLike = `%${esc(q)}%`;
  const byKind: Record<SearchHit["kind"], SearchHit[]> = { business: [], person: [], domain: [], invoice: [] };

  // Businesses: every word must match name or slug.
  const bizWhere = words.map(() => "(lower(t.name) LIKE ? ESCAPE '\\' OR t.slug LIKE ? ESCAPE '\\')").join(" AND ");
  const biz = controlSqlite
    .prepare(`SELECT t.id, t.name, t.slug, t.archived_at FROM tenants t WHERE ${bizWhere} ORDER BY t.name LIMIT ?`)
    .all(...likes.flatMap((l) => [l, l]), limit) as Array<{ id: number; name: string; slug: string; archived_at: number | null }>;
  for (const b of biz) {
    byKind.business.push({ kind: "business", id: b.id, title: b.name, subtitle: b.archived_at ? `${b.slug}, archived` : b.slug, href: `/gyms/${b.id}` });
  }

  // People: email or name, with the business they belong to.
  const people = controlSqlite
    .prepare(
      `SELECT u.id, u.email, u.name, t.id AS tenant_id, t.name AS tenant_name
       FROM users u JOIN memberships m ON m.user_id = u.id JOIN tenants t ON t.id = m.tenant_id
       WHERE (lower(u.email) LIKE ? ESCAPE '\\' OR lower(COALESCE(u.name, '')) LIKE ? ESCAPE '\\') AND u.is_platform_admin = 0
       ORDER BY u.email LIMIT ?`,
    )
    .all(qLike, qLike, limit) as Array<{ id: number; email: string; name: string | null; tenant_id: number; tenant_name: string }>;
  for (const p of people) {
    byKind.person.push({ kind: "person", id: p.id, title: p.name ? `${p.name} (${p.email})` : p.email, subtitle: p.tenant_name, href: `/gyms/${p.tenant_id}/people`, tenantId: p.tenant_id });
  }

  // Domains.
  const domains = controlSqlite
    .prepare(
      `SELECT d.id, d.host, t.id AS tenant_id, t.name AS tenant_name FROM site_domains d JOIN tenants t ON t.id = d.tenant_id
       WHERE lower(d.host) LIKE ? ESCAPE '\\' ORDER BY d.host LIMIT ?`,
    )
    .all(qLike, limit) as Array<{ id: number; host: string; tenant_id: number; tenant_name: string }>;
  for (const d of domains) {
    byKind.domain.push({ kind: "domain", id: d.id, title: d.host, subtitle: d.tenant_name, href: `/gyms/${d.tenant_id}/integrations`, tenantId: d.tenant_id });
  }

  // Invoices: "#123" or a gateway reference.
  const idMatch = /^#?(\d{1,9})$/.exec(q);
  const invoices = controlSqlite
    .prepare(
      `SELECT i.id, i.period_start, i.gross_cents, i.status, t.id AS tenant_id, t.name AS tenant_name
       FROM billing_invoices i JOIN tenants t ON t.id = i.tenant_id
       WHERE i.id = ? OR lower(COALESCE(i.gateway_ref, '')) LIKE ? ESCAPE '\\' ORDER BY i.id DESC LIMIT ?`,
    )
    .all(idMatch ? Number(idMatch[1]) : -1, qLike, limit) as Array<{ id: number; period_start: string; gross_cents: number; status: string; tenant_id: number; tenant_name: string }>;
  for (const i of invoices) {
    byKind.invoice.push({
      kind: "invoice",
      id: i.id,
      title: `Invoice #${i.id}, ${i.period_start}, €${(i.gross_cents / 100).toFixed(2)}`,
      subtitle: `${i.tenant_name}, ${i.status}`,
      href: `/gyms/${i.tenant_id}/money`,
      tenantId: i.tenant_id,
    });
  }

  const order: SearchHit["kind"][] = ["business", "person", "domain", "invoice"];
  const quota = Math.ceil(limit / 4);
  const out: SearchHit[] = [];
  const left: SearchHit[] = [];
  for (const k of order) {
    out.push(...byKind[k].slice(0, quota));
    left.push(...byKind[k].slice(quota));
  }
  return out.concat(left).slice(0, limit);
}
