"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { peopleAction, inviteAction, type PeopleActionResult, type PeopleOp } from "@/app/(console)/gyms/[id]/people/actions";
import { Card } from "@/components/ui/Card";
import type { TenantPeople } from "@/lib/types";

/**
 * The People tab's one interactive surface.
 *
 * A single client component rather than one per control, because every
 * action shares the same three things: a pending state, a result message,
 * and a refresh. Splitting them would mean five copies of that and five
 * places for the message to appear.
 *
 * Results are shown inline and kept until the next action. A reset link or
 * an unsent invite link is the one thing a staff member may need to copy, so
 * it is rendered as selectable text rather than a toast that vanishes.
 */
export function PeopleTable({ tenantId, data }: { tenantId: number; data: TenantPeople }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<PeopleActionResult | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function run(key: string, body: PeopleOp, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyKey(key);
    setResult(null);
    start(async () => {
      const r = await peopleAction(tenantId, body);
      setResult(r);
      setBusyKey(null);
      if (r.ok) router.refresh();
    });
  }

  function submitInvite(formData: FormData) {
    setBusyKey("invite");
    setResult(null);
    start(async () => {
      const r = await inviteAction(tenantId, formData);
      setResult(r);
      setBusyKey(null);
      if (r.ok) router.refresh();
    });
  }

  const admins = data.people.filter((p) => p.role === "admin" && p.membershipActive && p.accountActive);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {result && (
        <div
          role="status"
          style={{
            padding: "10px 14px",
            borderRadius: "var(--radius)",
            fontSize: 13.5,
            background: result.ok ? "rgba(63,185,80,.12)" : "rgba(240,128,154,.12)",
            border: `1px solid ${result.ok ? "rgba(63,185,80,.4)" : "rgba(240,128,154,.4)"}`,
            color: "var(--text-primary)",
          }}
        >
          {result.ok ? (result.note ?? "Done.") : result.error}
          {result.ok && result.link && (
            <div style={{ marginTop: 8 }}>
              <span style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Link to pass on: </span>
              <code style={{ userSelect: "all", wordBreak: "break-all", fontSize: 12.5 }}>{result.link}</code>
            </div>
          )}
        </div>
      )}

      <Card style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          People
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
          Everyone who can sign into this business. Revoking access ends their live sessions immediately.
        </p>
        {data.people.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>Nobody has access yet.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Sessions</th>
                <th>Last login</th>
                <th style={{ width: 1 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => {
                const disabled = pending || !p.accountActive;
                const revoked = !p.membershipActive;
                return (
                  <tr key={p.userId} style={revoked ? { opacity: 0.55 } : undefined}>
                    <td>
                      <div>{p.name ?? p.email}</div>
                      {p.name && <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{p.email}</div>}
                      <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                        {revoked && <span className="chip" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>access revoked</span>}
                        {!p.accountActive && <span className="chip" style={{ background: "rgba(240,128,154,.15)", color: "var(--red)" }}>account disabled</span>}
                        {p.mustChangePassword && <span className="chip" style={{ background: "var(--surface-2)" }}>must change password</span>}
                        {p.isPlatformStaff && <span className="chip" style={{ background: "rgba(232,93,36,.15)", color: "var(--accent)" }}>platform staff</span>}
                      </div>
                    </td>
                    <td>
                      <select
                        aria-label={`Role for ${p.email}`}
                        className="input"
                        value={p.role}
                        disabled={disabled || revoked}
                        onChange={(e) =>
                          run(`role-${p.userId}`, { op: "set-role", userId: p.userId, role: e.target.value as "admin" | "staff" })
                        }
                        style={{ height: 32, padding: "0 8px", fontSize: 13 }}
                      >
                        <option value="admin">admin</option>
                        <option value="staff">staff</option>
                      </select>
                    </td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{p.activeSessions}</td>
                    <td>{p.lastLoginAt ? new Date(p.lastLoginAt).toLocaleDateString("en-IE") : "Never"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={disabled}
                          onClick={() => run(`reset-${p.userId}`, { op: "reset-password", userId: p.userId })}
                        >
                          {busyKey === `reset-${p.userId}` ? "…" : "Reset password"}
                        </button>
                        {p.activeSessions > 0 && (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            disabled={pending}
                            onClick={() =>
                              run(`sessions-${p.userId}`, { op: "revoke-sessions", userId: p.userId }, `Sign ${p.email} out of this business?`)
                            }
                          >
                            Sign out
                          </button>
                        )}
                        {p.role !== "admin" && p.membershipActive && p.accountActive && (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            disabled={pending}
                            onClick={() =>
                              run(
                                `owner-${p.userId}`,
                                { op: "transfer-ownership", userId: p.userId },
                                `Make ${p.email} the owner? Every other admin becomes staff.`,
                              )
                            }
                          >
                            Make owner
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={pending}
                          onClick={() =>
                            run(
                              `access-${p.userId}`,
                              { op: "set-access", userId: p.userId, active: revoked },
                              revoked ? undefined : `Revoke ${p.email}'s access to this business?`,
                            )
                          }
                          style={revoked ? undefined : { color: "var(--red)" }}
                        >
                          {revoked ? "Restore access" : "Revoke access"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {admins.length === 1 && (
          <p style={{ margin: "14px 0 0", fontSize: 12.5, color: "var(--text-secondary)" }}>
            {admins[0].email} is the only admin who can sign in. They cannot be demoted or revoked until someone else is made an admin.
          </p>
        )}
      </Card>

      <Card style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          Invite someone
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
          They get an email in this business&rsquo;s branding with a link to set their password. Someone who already has an
          AdonisAgent account is added straight away and keeps their current login.
        </p>
        <form action={submitInvite} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 220px" }}>
            <label htmlFor="invite-email" className="mono-label" style={{ display: "block", marginBottom: 6 }}>Email</label>
            <input id="invite-email" className="input" type="email" name="email" required placeholder="name@business.ie" style={{ width: "100%" }} />
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <label htmlFor="invite-name" className="mono-label" style={{ display: "block", marginBottom: 6 }}>Name (optional)</label>
            <input id="invite-name" className="input" type="text" name="name" placeholder="Their name" style={{ width: "100%" }} />
          </div>
          <div>
            <label htmlFor="invite-role" className="mono-label" style={{ display: "block", marginBottom: 6 }}>Role</label>
            <select id="invite-role" className="input" name="role" defaultValue="staff" style={{ height: 38, padding: "0 10px" }}>
              <option value="staff">staff</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <button className="btn btn--primary btn--md" type="submit" disabled={pending}>
            {busyKey === "invite" ? "Sending…" : "Send invite"}
          </button>
        </form>
      </Card>

      <Card style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          Pending invites
        </h2>
        {data.invites.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>None outstanding.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Invited by</th>
                <th>Expires</th>
                <th style={{ width: 1 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{i.role}</td>
                  <td style={{ color: "var(--text-secondary)" }}>{i.invitedByEmail ?? "—"}</td>
                  <td style={{ color: i.expired ? "var(--red)" : undefined }}>
                    {i.expired ? "Expired" : new Date(i.expiresAt).toLocaleDateString("en-IE")}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={pending}
                        onClick={() => run(`resend-${i.id}`, { op: "resend-invite", email: i.email })}
                      >
                        {busyKey === `resend-${i.id}` ? "…" : "Resend"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={pending}
                        onClick={() => run(`cancel-${i.id}`, { op: "cancel-invite", inviteId: i.id }, `Cancel the invite for ${i.email}?`)}
                        style={{ color: "var(--red)" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {data.resets.length > 0 && (
        <Card style={{ padding: 24 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
            Open password resets
          </h2>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
            Links that have been issued and not used yet.
          </p>
          <table className="tbl">
            <thead>
              <tr>
                <th>Person</th>
                <th>Issued</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {data.resets.map((r) => (
                <tr key={`${r.userId}-${r.createdAt}`}>
                  <td>{r.email}</td>
                  <td>{new Date(r.createdAt).toLocaleString("en-IE")}</td>
                  <td>{new Date(r.expiresAt).toLocaleString("en-IE")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
