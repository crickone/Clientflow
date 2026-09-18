import Link from "next/link";
import { notFound } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { fmtCents, fmtDate, fmtDay } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import type { AuditResponse, TenantDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The Overview tab: what you want to know in the first five seconds of
 * opening a business, with a link into the tab that can act on each thing.
 *
 * Deliberately read-only. Every button on this page would be a second place
 * to do something that already has a home, and a console where the same
 * action lives in two places is one where the audit trail is the only way to
 * tell what actually happened.
 */
export default async function TenantOverviewPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  let data: TenantDetail;
  try {
    data = await api<TenantDetail>(`/tenants/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  // The audit log is best-effort here: a console that cannot show its own
  // recent activity should still show the account.
  let recent: AuditResponse["entries"] = [];
  try {
    recent = (await api<AuditResponse>(`/audit?tenantId=${id}&limit=5`)).entries;
  } catch {
    recent = [];
  }

  const { tenant, usage, invoices, ai, voice, email, emailBalanceCents, addons } = data;
  const billing = tenant.billing;
  const outstanding = invoices.filter((i) => i.status === "pending" || i.status === "failed");
  const liveAddons = addons.filter((a) => a.status !== "cancelled");

  const facts: { label: string; value: string; href?: string; tone?: "warn" | "bad" }[] = [
    {
      label: "Billing",
      value: billing?.billingExempt ? "Exempt (never charged)" : (billing?.status ?? "No billing row"),
      href: `/gyms/${id}/money`,
      tone: billing?.status === "past_due" || billing?.status === "suspended" ? "bad" : undefined,
    },
    {
      label: "Next renewal",
      value: billing?.nextRenewalAt ? fmtDay(billing.nextRenewalAt) : "—",
      href: `/gyms/${id}/money`,
    },
    {
      label: "Outstanding",
      value: outstanding.length ? `${outstanding.length} invoice${outstanding.length === 1 ? "" : "s"}` : "None",
      href: `/gyms/${id}/money`,
      tone: outstanding.length ? "warn" : undefined,
    },
    { label: "Members", value: String(usage.clients) },
    { label: "Staff", value: String(usage.staff) },
    { label: "Card", value: billing?.cardLast4 ? `•••• ${billing.cardLast4}` : "None on file" },
  ];

  const credits: { label: string; value: string; note: string; suspended: boolean }[] = [
    {
      label: "AI",
      value: fmtCents(ai.balanceCents),
      note: `${fmtCents(ai.monthlyUsedCents)} used this month of ${fmtCents(ai.freeTrancheCents)} included`,
      suspended: ai.suspended,
    },
    {
      label: "Email",
      value: fmtCents(emailBalanceCents),
      note: `${email.sentThisMonth.toLocaleString()} sent of ${email.includedPerMonth.toLocaleString()} included`,
      suspended: data.marketingSuspended,
    },
    {
      label: "Voice",
      value: fmtCents(voice.balanceCents),
      note: `${voice.month.billedMinutes} min this month · ${voice.includedMinutesRemaining} included left`,
      suspended: voice.suspended,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          At a glance
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 20 }}>
          {facts.map((f) => (
            <div key={f.label}>
              <div className="mono-label" style={{ marginBottom: 6 }}>{f.label}</div>
              <div
                style={{
                  fontSize: 15,
                  color: f.tone === "bad" ? "var(--red)" : f.tone === "warn" ? "var(--amber)" : "var(--text-primary)",
                }}
              >
                {f.href ? (
                  <Link href={f.href} style={{ color: "inherit", textDecoration: "none" }}>
                    {f.value}
                  </Link>
                ) : (
                  f.value
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          Credits
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
          Grant, cap or suspend any of these on the{" "}
          <Link href={`/gyms/${id}/money`} style={{ color: "var(--accent)" }}>Money tab</Link>.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 20 }}>
          {credits.map((c) => (
            <div key={c.label}>
              <div className="mono-label" style={{ marginBottom: 6, display: "flex", gap: 8, alignItems: "center" }}>
                {c.label}
                {c.suspended && (
                  <span className="chip" style={{ background: "rgba(240,128,154,.15)", color: "var(--red)" }}>
                    suspended
                  </span>
                )}
              </div>
              <div style={{ fontSize: 19, fontVariantNumeric: "tabular-nums" }}>{c.value}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 3 }}>{c.note}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          Add-ons
        </h2>
        {liveAddons.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>None enabled.</p>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {liveAddons.map((a) => (
              <span key={a.key} className="chip" style={{ background: "var(--surface-2)" }}>
                {a.name} · {a.status} · {fmtCents(a.priceCents)}
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card style={{ padding: 24 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
            Recent staff activity
          </h2>
          <Link href={`/gyms/${id}/timeline`} style={{ fontSize: 13, color: "var(--accent)", marginLeft: "auto" }}>
            Full timeline
          </Link>
        </div>
        {recent.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>
            Nothing recorded yet for this business.
          </p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Action</th>
                <th>Who</th>
                <th>Reason</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e) => (
                <tr key={e.id}>
                  <td style={{ color: e.ok ? undefined : "var(--red)" }}>
                    {e.action}
                    {!e.ok && " (refused)"}
                  </td>
                  <td>{e.actorEmail}</td>
                  <td style={{ color: "var(--text-secondary)" }}>{e.reason ?? "—"}</td>
                  <td>{fmtDate(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
