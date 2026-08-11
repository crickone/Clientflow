"use client";

import { useState } from "react";

import { fmtCents } from "@/lib/format";

/**
 * The console's one free-numeric-input tenant action — every other action on
 * the gym-detail page is a `ConfirmButton` bound to fixed, pre-set params
 * (see gyms/[id]/page.tsx). ConfirmButton doesn't fit here: it expects a
 * zero-arg action, but the grant amount comes from live user input, not a
 * bound param. A grant has no "un-grant" from here, so this guards the
 * native form submission with a plain confirm() that echoes back the parsed
 * €-amount — cheap insurance against a double-click or a fat-fingered digit
 * (e.g. 500 instead of 50). Calling `event.preventDefault()` in `onSubmit`
 * cancels the pending server-action submission, same as it would for a plain
 * form post.
 */
export function GrantCreditsForm({
  action,
}: {
  /** `grantCreditsAction` bound to the tenant id (see ./actions.ts). */
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [euros, setEuros] = useState("");

  return (
    <form
      action={action}
      onSubmit={(e) => {
        const amount = parseFloat(euros);
        const label =
          Number.isFinite(amount) && amount > 0 ? fmtCents(Math.round(amount * 100)) : "this amount";
        if (!window.confirm(`Grant ${label} in credits to this business? This can't be undone from here.`)) {
          e.preventDefault();
        }
      }}
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
          value={euros}
          onChange={(e) => setEuros(e.target.value)}
          style={{ width: 140 }}
        />
      </label>
      <button className="btn btn--primary btn--sm" type="submit">
        Grant
      </button>
    </form>
  );
}
