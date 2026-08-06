/// <reference types="react-dom/canary" />
"use client";

import { useRef, useState, type CSSProperties } from "react";
import { useFormState, useFormStatus } from "react-dom";

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
      {pending ? "Creating…" : "Create gym"}
    </button>
  );
}

const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const labelText: CSSProperties = { fontSize: 12.5, color: "var(--muted)" };

export default function ProvisionPage() {
  const [state, formAction] = useFormState(provisionGym, initialState);
  const [slug, setSlug] = useState("");
  const slugTouched = useRef(false);

  if (state.ok) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 480 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Provision gym</h1>
        <div className="glass" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--green)" }}>✓ {state.name} is live</div>
          <div style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>
            Owner: <span style={{ color: "var(--text-primary)" }}>{state.ownerEmail}</span>
          </div>
          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>
              Temporary password
            </div>
            <code
              style={{
                display: "block",
                background: "var(--surface-2)",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius)",
                padding: "10px 12px",
                fontSize: 14,
                userSelect: "all",
              }}
            >
              {state.tempPassword}
            </code>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-secondary)" }}>
            They&apos;ll be asked to change it on first sign-in, then taken to the payment screen.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <a className="btn btn--primary btn--md" href={`/gyms/${state.tenantId}`}>
              View gym
            </a>
            <a className="btn btn--secondary btn--md" href="/provision">
              Provision another
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 480 }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Provision gym</h1>
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

        <label style={label}>
          <span style={labelText}>Owner email</span>
          <input className="input" type="email" name="ownerEmail" required />
        </label>

        <label style={label}>
          <span style={labelText}>Owner name (optional)</span>
          <input className="input" name="ownerName" />
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
