/// <reference types="react-dom/canary" />
"use client";

import { useRef, useState, type CSSProperties } from "react";
import { useFormState, useFormStatus } from "react-dom";

import { OpenBusinessButton } from "@/components/OpenBusinessButton";
import { openTenant } from "../gyms/[id]/actions";
import { provisionGym, type ProvisionState } from "./actions";

const initialState: ProvisionState = { ok: false };

/** lowercase, spaces→hyphens, strip anything outside [a-z0-9-]. */
function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn--primary btn--md" type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create business"}
    </button>
  );
}

const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const labelText: CSSProperties = { fontSize: 12.5, color: "var(--muted)" };

interface AdminRow {
  key: number;
  email: string;
  name: string;
}

export default function ProvisionPage() {
  const [state, formAction] = useFormState(provisionGym, initialState);
  const [slug, setSlug] = useState("");
  const slugTouched = useRef(false);

  const nextRowKey = useRef(1);
  const [admins, setAdmins] = useState<AdminRow[]>([{ key: 0, email: "", name: "" }]);
  const [addMe, setAddMe] = useState(true);

  function updateAdmin(key: number, field: "email" | "name", value: string) {
    setAdmins((rows) => rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }
  function addAdminRow() {
    setAdmins((rows) => [...rows, { key: nextRowKey.current++, email: "", name: "" }]);
  }
  function removeAdminRow(key: number) {
    setAdmins((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows));
  }

  if (state.ok) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 560 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Provision business</h1>
        <div className="glass" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--green)" }}>✓ {state.name} is live</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {state.admins.map((a) => (
              <div
                key={a.email}
                style={{
                  border: "1px solid var(--hairline)",
                  borderRadius: "var(--radius)",
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--text-primary)" }}>{a.email}</span>
                  {a.owner && (
                    <span className="chip" style={{ background: "var(--surface-2)", color: "var(--text-tertiary)" }}>
                      Owner
                    </span>
                  )}
                </div>
                {a.tempPassword ? (
                  <div>
                    <div className="mono-label" style={{ marginBottom: 4 }}>
                      Temporary password
                    </div>
                    <code
                      style={{
                        display: "block",
                        background: "var(--surface-2)",
                        border: "1px solid var(--hairline)",
                        borderRadius: "var(--radius)",
                        padding: "8px 10px",
                        fontSize: 13,
                        userSelect: "all",
                      }}
                    >
                      {a.tempPassword}
                    </code>
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Uses their existing login.</div>
                )}
              </div>
            ))}
          </div>

          {state.addMe && (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-secondary)" }}>
              You&apos;ve also been added as an admin — use &quot;Open business&quot; below to jump straight in.
            </p>
          )}

          <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-secondary)" }}>
            New admins will be asked to set their own password on first sign-in, then taken to the payment screen.
          </p>

          <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
            <a className="btn btn--primary btn--md" href={`/gyms/${state.tenantId}`}>
              View business
            </a>
            <OpenBusinessButton
              action={openTenant.bind(null, state.tenantId)}
              label="Open business"
              className="btn btn--secondary btn--md"
            />
            <a className="btn btn--secondary btn--md" href="/provision">
              Provision another
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 560 }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Provision business</h1>
      <form action={formAction} className="glass" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <label style={label}>
          <span style={labelText}>Name</span>
          <input
            className="input"
            name="name"
            required
            onBlur={(e) => {
              if (!slugTouched.current) setSlug(sanitizeSlug(e.target.value));
            }}
          />
        </label>

        <label style={label}>
          <span style={labelText}>Slug</span>
          <input
            className="input"
            name="slug"
            required
            value={slug}
            onChange={(e) => {
              slugTouched.current = true;
              setSlug(e.target.value);
            }}
          />
        </label>

        <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <legend style={{ ...labelText, padding: 0, marginBottom: 4 }}>Venue type</legend>
          <div style={{ display: "flex", gap: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
              <input type="radio" name="venueType" value="gym" defaultChecked />
              Gym
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
              <input type="radio" name="venueType" value="clinic" />
              Clinic
            </label>
          </div>
        </fieldset>

        <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <legend style={{ ...labelText, padding: 0, marginBottom: 4 }}>Admins</legend>
          {admins.map((row, i) => (
            <div key={row.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="input"
                type="email"
                name="adminEmail"
                required={i === 0}
                placeholder={i === 0 ? "Owner email" : "Admin email"}
                value={row.email}
                onChange={(e) => updateAdmin(row.key, "email", e.target.value)}
                style={{ flex: "1 1 auto" }}
              />
              <input
                className="input"
                name="adminName"
                placeholder="Name (optional)"
                value={row.name}
                onChange={(e) => updateAdmin(row.key, "name", e.target.value)}
                style={{ flex: "1 1 auto" }}
              />
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => removeAdminRow(row.key)}
                disabled={admins.length === 1}
                aria-label="Remove admin"
              >
                ✕
              </button>
            </div>
          ))}
          <div>
            <button type="button" className="btn btn--secondary btn--sm" onClick={addAdminRow}>
              + Add another admin
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-tertiary)" }}>
            The first admin is the owner. An email that already has a ClientFlow login is just added to this
            business — no new password.
          </p>
        </fieldset>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
          <input type="checkbox" name="addMe" checked={addMe} onChange={(e) => setAddMe(e.target.checked)} />
          Also add me (this platform admin) as an admin
        </label>

        {state.error && (
          <p role="alert" style={{ margin: 0, color: "var(--red)", fontSize: 13 }}>
            {state.error}
          </p>
        )}

        <div>
          <SubmitButton />
        </div>
      </form>
    </div>
  );
}
