"use client";

import { useState } from "react";

// Mirrors lib/campaigns/signup.ts's MAX_FIELD_LEN/MAX_MESSAGE_LEN (that
// module doesn't export them — they're module-private consts — so these are
// duplicated literals, not an import). Client-side maxLength is just a nicer
// first line of defence than waiting for the server's 400; the server's own
// validateSignup() is the actual enforcement and stays authoritative either
// way, so a mismatch here would be a UX papercut, never a security issue.
const MAX_FIELD_LEN = 200;
const MAX_MESSAGE_LEN = 2000;

// The submit CTA is a business INVARIANT — always exactly "Sign up", never a
// price, a booking action, or a guarantee, regardless of what an approved
// landing_page asset's AI-generated `ctaLabel` says. The generation prompt
// already instructs the model to return exactly this string (see
// lib/campaigns/generate.ts's landing_page prompt), but a mis-generated
// asset could still slip a different value past an operator's approval —
// the model's output was never a reliable source for the DISPLAYED button
// text, so it's hardcoded here instead of threaded in as a prop from the
// stored/generated body.
const CTA_LABEL = "Sign up";

interface Props {
  /** The server-signed (tenantId, campaignId) claim minted by the route
   *  (signCampaignSignupToken) — the ONLY thing this form sends that names a
   *  tenant or campaign. Opaque to this component; just relayed verbatim in
   *  the POST body. */
  token: string;
}

/**
 * The public campaign-landing "Sign up" form (Campaign Engine Slice 2, Task
 * 3). Posts JSON straight to /api/campaigns/signup — a RELATIVE url, so this
 * works unchanged on any host (platform default or a client's own verified
 * domain) and needs no siteSlug/campaignSlug: the signed `token` alone
 * carries tenant+campaign identity (see lib/campaigns/signupToken.ts). No
 * external deps; no <form action=…> no-JS fallback (unlike
 * components/forms/PublicFormView.tsx's `/f/<slug>/submit`, this endpoint
 * only ever accepts a JSON body — see api/campaigns/signup/route.ts — so a
 * plain browser form-urlencoded POST would just 400).
 */
export function SignupForm({ token }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const fd = new FormData(e.currentTarget);
    const payload = {
      token,
      name: String(fd.get("name") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      email: String(fd.get("email") ?? ""),
      message: String(fd.get("message") ?? ""),
      // Honeypot — real visitors never see or fill this (visually hidden
      // below). A bot that fills every field it finds trips it; the route
      // treats a non-empty value as silent success, no lead created.
      website: String(fd.get("website") ?? ""),
    };

    // Mirrors the server's own rule exactly (lib/campaigns/signup.ts's
    // validateSignup: name required + at-least-one-of email/phone). `name`
    // is already enforced by that field's HTML `required` (the browser
    // blocks submission before this handler even runs), so this only needs
    // to catch the email-or-phone half — otherwise a visitor who fills only
    // their name wouldn't find out until the server's 400 comes back.
    if (!payload.email.trim() && !payload.phone.trim()) {
      setError("Add an email or phone number so we can get back to you");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/campaigns/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error || "Something went wrong — please try again.");
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div style={thanksStyle} role="status">
        <p style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "var(--text-primary)" }}>
          Thanks — we&apos;ll be in touch.
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--text-secondary)" }}>
          Your details have been received.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }} noValidate={false}>
      {/* Honeypot: hidden from people, catnip for bots — mirrors
          components/forms/PublicFormView.tsx's own protection. */}
      <div aria-hidden="true" style={honeypotStyle}>
        <label htmlFor="cl-su-website">Website</label>
        <input type="text" id="cl-su-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <Field id="cl-su-name" name="name" label="Name" type="text" required autoComplete="name" maxLength={MAX_FIELD_LEN} />
      <Field id="cl-su-phone" name="phone" label="Phone" type="tel" autoComplete="tel" maxLength={MAX_FIELD_LEN} />
      <Field id="cl-su-email" name="email" label="Email" type="email" autoComplete="email" maxLength={MAX_FIELD_LEN} />

      <div>
        <label htmlFor="cl-su-message" style={labelStyle}>
          Message <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(optional)</span>
        </label>
        <textarea id="cl-su-message" name="message" rows={3} maxLength={MAX_MESSAGE_LEN} style={inputStyle} className="field" />
      </div>

      {error && (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      )}

      <button type="submit" disabled={submitting} style={submitBtnStyle(submitting)}>
        {submitting ? "Sending…" : CTA_LABEL}
      </button>
    </form>
  );
}

function Field({
  id,
  name,
  label,
  type,
  required,
  autoComplete,
  maxLength,
}: {
  id: string;
  name: string;
  label: string;
  type: string;
  required?: boolean;
  autoComplete?: string;
  maxLength?: number;
}) {
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>
        {label}
        {required && <span style={{ color: "var(--accent)" }}> *</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        maxLength={maxLength}
        style={inputStyle}
        className="field"
      />
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  marginBottom: 6,
  color: "var(--text-secondary)",
};

// Every field also carries className="field" (not just this inline style)
// so it picks up globals.css's `.field:focus, .field:focus-visible` rule —
// inline styles can't express pseudo-classes, and outline:none below with
// no replacement focus ring would otherwise leave keyboard users with no
// visible focus indicator. globals.css loads unconditionally on every
// route (see app/layout.tsx's top-level `import "./globals.css"`), so this
// class is available here even though the page never enters the admin
// shell — same idiom components/ui/Input.tsx uses (`cn("field", className)`
// alongside its own inline styles).
//
// 16px input font-size is deliberate, not just "a bit bigger than the rest
// of the form" — anything smaller makes iOS Safari auto-zoom the viewport on
// focus, which on a mobile-first public form is exactly the kind of papercut
// worth avoiding.
//
// background is --bg (the page canvas), not --surface-1 — this form always
// renders inside CampaignLanding's own surface-1 card, so an input using
// that SAME token would be visually invisible against its own container
// (indistinguishable except for the 1px border). --bg reliably contrasts
// against the surface-1 card regardless of how subtle a given theme's
// derived surface step is.
const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--bg)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: "11px 13px",
  color: "var(--text-primary)",
  fontSize: 16,
  outline: "none",
  fontFamily: "inherit",
};

const errorStyle: React.CSSProperties = { color: "#f87171", fontSize: 13.5, margin: 0 };

const honeypotStyle: React.CSSProperties = {
  position: "absolute",
  left: -9999,
  width: 1,
  height: 1,
  overflow: "hidden",
};

const thanksStyle: React.CSSProperties = {
  padding: "18px 4px",
};

function submitBtnStyle(submitting: boolean): React.CSSProperties {
  return {
    marginTop: 2,
    padding: "13px 20px",
    borderRadius: 8,
    border: "none",
    background: "var(--accent)",
    // Ink that sits ON the accent fill — matches .btn--primary in globals.css.
    // Uses the theme-aware --accent-contrast (flips with the accent's luminance)
    // so it reads on a dark (light-mode) accent too, not just bright presets.
    color: "var(--accent-contrast)",
    fontWeight: 600,
    fontSize: 15,
    cursor: submitting ? "default" : "pointer",
    opacity: submitting ? 0.7 : 1,
    width: "100%",
  };
}
