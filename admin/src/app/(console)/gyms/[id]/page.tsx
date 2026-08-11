import Link from "next/link";
import { notFound } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { fmtCents, fmtDate, fmtDay } from "@/lib/format";
import { StatusChip } from "@/components/StatusChip";
import { ConfirmButton } from "@/components/ConfirmButton";
import { OpenBusinessButton } from "@/components/OpenBusinessButton";
import { Card } from "@/components/ui/Card";
import type { InvoiceRow, TenantDetail } from "@/lib/types";
import { tenantAction, openTenant, grantCreditsAction } from "./actions";

/** Invoice statuses are a different vocabulary from billing statuses, so they
 *  don't reuse the `.chip.<status>` CSS — colour them inline instead. */
const INVOICE_CHIP: Record<InvoiceRow["status"], { bg: string; fg: string }> = {
  paid: { bg: "rgba(63,185,80,.15)", fg: "var(--green)" },
  pending: { bg: "rgba(47,107,255,.15)", fg: "#9cc4ff" },
  failed: { bg: "rgba(240,128,154,.15)", fg: "var(--red)" },
  waived: { bg: "var(--surface-2)", fg: "var(--muted)" },
  refunded: { bg: "rgba(242,193,78,.15)", fg: "var(--amber)" },
};

function InvoiceChip({ status }: { status: InvoiceRow["status"] }) {
  const c = INVOICE_CHIP[status];
  return (
    <span className="chip" style={{ background: c.bg, color: c.fg }}>
      {status}
    </span>
  );
}

export default async function GymDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string; granted?: string };
}) {
  const id = Number(params.id);
  let data: TenantDetail;
  try {
    data = await api<TenantDetail>(`/tenants/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const { tenant, usage, invoices, events } = data;
  const billing = tenant.billing;
  const status = billing?.status ?? null;
  const canAct = billing !== null && !billing.billingExempt;
  const hasOutstanding = invoices.some((i) => i.status === "pending" || i.status === "failed");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <Link href="/gyms" style={{ fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}>
          ← All businesses
        </Link>
      </div>

      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{tenant.name}</h1>
          <StatusChip status={status} exempt={billing?.billingExempt} />
          <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-secondary)", background: "var(--surface-2)", border: "1px solid var(--grid)", borderRadius: 999, padding: "3px 10px" }}>
            {tenant.venueType ?? "Not set"}
          </span>
          <span style={{ marginLeft: "auto" }}>
            <OpenBusinessButton
              action={openTenant.bind(null, tenant.id)}
              label="Open business"
              className="btn btn--primary btn--sm"
            />
          </span>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          <span style={{ fontFamily: "ui-monospace, monospace" }}>{tenant.slug}</span>
          {"  ·  "}
          {usage.clients} members · {usage.staff} staff
        </div>
      </div>

      {/* Billing panel */}
      <Card style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>Billing</h2>
        <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>
              Card on file
            </div>
            <div style={{ fontSize: 14 }}>
              {billing?.cardLast4 ? `•••• ${billing.cardLast4}` : "No card"}
            </div>
          </div>
          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>
              Next renewal
            </div>
            <div style={{ fontSize: 14 }}>{fmtDay(billing?.nextRenewalAt ?? null)}</div>
          </div>
        </div>

        {billing === null ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13 }}>No billing configured for this business.</p>
        ) : billing.billingExempt ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className="chip exempt">Exempt</span>
              <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                Billing exempt (agency) — usable, never billed.
              </span>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <ConfirmButton
                label="Remove exemption"
                confirm="Remove billing exemption for this business? It moves to Awaiting payment and re-enters the payment gate."
                action={tenantAction.bind(null, tenant.id, "unexempt", {})}
              />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
              {hasOutstanding && (
                <ConfirmButton
                  label="Charge now"
                  className="btn btn--primary btn--sm"
                  confirm="Attempt to charge the card on file for the outstanding invoice now?"
                  action={tenantAction.bind(null, tenant.id, "charge-now", {})}
                />
              )}
              {status === "suspended" ? (
                <ConfirmButton
                  label="Reactivate"
                  confirm="Reactivate this business?"
                  action={tenantAction.bind(null, tenant.id, "reactivate", {})}
                />
              ) : status !== "cancelled" ? (
                <ConfirmButton
                  label="Suspend"
                  danger
                  confirm="Suspend this business? Members lose access until it is reactivated."
                  action={tenantAction.bind(null, tenant.id, "suspend", {})}
                />
              ) : null}
              {billing.nextRenewalAt && (
                <ConfirmButton
                  label="Comp 1 month"
                  confirm="Comp one month? This pushes the next renewal date out by a month."
                  action={tenantAction.bind(null, tenant.id, "comp", { months: 1 })}
                />
              )}
              <ConfirmButton
                label="Exempt (comp)"
                confirm="Mark this business billing-exempt? It becomes usable and is never billed until exemption is removed."
                action={tenantAction.bind(null, tenant.id, "exempt", {})}
              />
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-tertiary)" }}>
              Marks this business comp — usable, never billed.
            </p>
          </div>
        )}
      </Card>

      {/* Venue type */}
      <Card style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>Venue type</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>
              Current
            </div>
            <div style={{ fontSize: 14, textTransform: "capitalize" }}>
              {tenant.venueType ?? <span style={{ color: "var(--text-tertiary)", textTransform: "none" }}>Not set</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <ConfirmButton
              label="Gym"
              className={tenant.venueType === "gym" ? "btn btn--primary btn--sm" : "btn btn--secondary btn--sm"}
              action={tenantAction.bind(null, tenant.id, "venue-type", { venueType: "gym" })}
            />
            <ConfirmButton
              label="Clinic"
              className={tenant.venueType === "clinic" ? "btn btn--primary btn--sm" : "btn btn--secondary btn--sm"}
              action={tenantAction.bind(null, tenant.id, "venue-type", { venueType: "clinic" })}
            />
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-tertiary)" }}>
          Drives this business&apos;s own app vocabulary and scheduling mode (Clients/Appointments vs Members/Classes).
        </p>
      </Card>

      {/* Email marketing */}
      <Card style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>Email marketing</h2>
        <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>
              Credit balance
            </div>
            <div style={{ fontSize: 14 }}>{fmtCents(data.emailBalanceCents)}</div>
          </div>
          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>
              Auto top-up
            </div>
            <div style={{ fontSize: 14 }}>
              {data.autoTopup.enabled
                ? `On — tops up ${fmtCents(data.autoTopup.amountCents)} below ${fmtCents(data.autoTopup.thresholdCents)}`
                : "Off"}
            </div>
          </div>
          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>
              Status
            </div>
            <span className={`chip ${data.marketingSuspended ? "suspended" : "active"}`}>
              {data.marketingSuspended ? "suspended" : "active"}
            </span>
          </div>
        </div>

        <form
          action={grantCreditsAction.bind(null, tenant.id)}
          style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Grant credits (EUR)</span>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0.01"
              max="10000"
              name="euros"
              placeholder="50.00"
              required
              style={{ width: 140 }}
            />
          </label>
          <button className="btn btn--primary btn--sm" type="submit">
            Grant
          </button>
        </form>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {data.marketingSuspended ? (
            <ConfirmButton
              label="Resume marketing"
              confirm="Resume email marketing for this business? Campaigns can be sent again."
              action={tenantAction.bind(null, tenant.id, "resume-marketing", {})}
            />
          ) : (
            <ConfirmButton
              label="Suspend marketing"
              danger
              confirm="Suspend email marketing for this business? No campaigns can be sent until resumed."
              action={tenantAction.bind(null, tenant.id, "suspend-marketing", {})}
            />
          )}
        </div>

        {searchParams.error && (
          <p role="alert" style={{ margin: 0, color: "var(--red)", fontSize: 13 }}>
            {searchParams.error}
          </p>
        )}
        {searchParams.granted && !searchParams.error && (
          <p style={{ margin: 0, color: "var(--green)", fontSize: 13 }}>Credits granted.</p>
        )}
      </Card>

      {/* Invoices */}
      <Card style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>Invoices</h2>
        {invoices.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>No invoices yet.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Period</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const actionable = inv.status === "pending" || inv.status === "failed";
                return (
                  <tr key={inv.id}>
                    <td>
                      {inv.periodStart} → {inv.periodEnd}
                    </td>
                    <td>
                      <div>{fmtCents(inv.grossCents)}</div>
                      <div style={{ fontSize: 11, color: "var(--muted-2)" }}>
                        incl. {fmtCents(inv.vatCents)} VAT
                      </div>
                    </td>
                    <td>
                      <InvoiceChip status={inv.status} />
                      {inv.attemptCount > 0 && (
                        <span style={{ fontSize: 11, color: "var(--muted-2)", marginLeft: 6 }}>
                          attempt {inv.attemptCount}
                        </span>
                      )}
                    </td>
                    <td>
                      {actionable ? (
                        <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                          <ConfirmButton
                            label="Mark paid"
                            confirm="Mark this invoice as paid?"
                            action={tenantAction.bind(null, tenant.id, "mark-paid", { invoiceId: inv.id })}
                          />
                          <ConfirmButton
                            label="Waive"
                            danger
                            confirm="Waive this invoice? The period is forgiven and billing moves forward."
                            action={tenantAction.bind(null, tenant.id, "waive", { invoiceId: inv.id })}
                          />
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted-2)" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Events */}
      <Card style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>Events</h2>
        {events.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>No events yet.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Type</th>
                <th>Actor</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{e.type}</td>
                  <td>{e.actor}</td>
                  <td>{fmtDate(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Danger zone */}
      <Card style={{ padding: 24, borderColor: "var(--red)" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em", color: "var(--red)" }}>Danger zone</h2>
        <p style={{ margin: "0 0 14px", color: "var(--text-secondary)", fontSize: 13 }}>
          Offboarding archives the business&apos;s data (DB + members + invoices), then permanently deletes the
          account — tenant, billing, memberships, domains — and its live database. The slug is freed for
          re-provisioning. This cannot be undone from here.
        </p>
        <ConfirmButton
          label="Offboard business"
          danger
          slug={tenant.slug}
          redirectTo="/gyms"
          action={tenantAction.bind(null, tenant.id, "offboard", {})}
        />
      </Card>
    </div>
  );
}
