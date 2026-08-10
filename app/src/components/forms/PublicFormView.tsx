"use client";

import { useState } from "react";

import type { FormInput, QuestionInput } from "@/lib/formsModel";

// Field types the builders can produce that this v1 can't accept yet (no
// upload storage/endpoint — deferred, see the batch report). Rendered as an
// inline note instead of an input; never blocks submission.
const UNSUPPORTED = new Set(["photo", "video"]);

interface Props {
  slug: string;
  tenantName: string;
  form: FormInput;
  initialOk: boolean;
  initialError?: string;
}

/**
 * The public `/f/<slug>` form. A real `<form method="POST" action=…>` so it
 * still works with JS disabled (the submit route branches on Content-Type —
 * see f/[slug]/submit/route.ts); the onSubmit handler below is a progressive
 * enhancement that intercepts the post to show the result inline instead of a
 * full-page redirect. Self-contained inline styles (not the admin Input/
 * Button components) — this is a public, unauthenticated page and shouldn't
 * depend on the admin shell's theme, matching site/[siteSlug]'s holding-screen
 * precedent.
 */
export function PublicFormView({ slug, tenantName, form, initialOk, initialError }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(initialOk);
  const [error, setError] = useState<string | null>(initialError ? safeDecode(initialError) : null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const payload: Record<string, string> = {};
    fd.forEach((value, key) => {
      payload[key] = typeof value === "string" ? value : "";
    });

    try {
      const res = await fetch(`/f/${slug}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
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

  if (!form.status) {
    return (
      <Shell tenantName={tenantName}>
        <h1 style={titleStyle}>Not accepting submissions</h1>
        <p style={bodyTextStyle}>This form isn&apos;t live right now. Please check back later.</p>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell tenantName={tenantName}>
        <h1 style={titleStyle}>Thanks!</h1>
        <p style={bodyTextStyle}>Your submission has been received. We&apos;ll be in touch soon.</p>
      </Shell>
    );
  }

  return (
    <Shell tenantName={tenantName}>
      <h1 style={titleStyle}>{form.title || "Get in touch"}</h1>
      <form
        method="POST"
        action={`/f/${slug}/submit`}
        onSubmit={onSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 20 }}
        noValidate={false}
      >
        {/* Honeypot: hidden from people, catnip for bots. Real visitors never
            fill this in — mirrors api/site-demo-lead's protection. */}
        <div aria-hidden="true" style={honeypotStyle}>
          <label htmlFor="pf-company-website">Company website</label>
          <input type="text" id="pf-company-website" name="company_website" tabIndex={-1} autoComplete="off" />
        </div>

        {form.questions.map((q) => (
          <Field key={q.id} question={q} />
        ))}

        {error && (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} style={submitBtnStyle(submitting)}>
          {submitting ? "Sending…" : "Submit"}
        </button>
      </form>
    </Shell>
  );
}

function Field({ question }: { question: QuestionInput }) {
  const name = `q_${question.id}`;

  if (UNSUPPORTED.has(question.fieldType)) {
    return (
      <div>
        <FieldLabel question={question} required={false} />
        <p style={unsupportedNoteStyle}>
          Uploads aren&apos;t supported on this form yet — please mention it in a text answer, or contact us
          directly.
        </p>
      </div>
    );
  }

  return (
    <div>
      <FieldLabel question={question} required={question.required} />
      {question.fieldType === "long" ? (
        <textarea id={name} name={name} required={question.required} style={inputStyle} rows={4} />
      ) : question.fieldType === "dropdown" ? (
        <select id={name} name={name} required={question.required} defaultValue="" style={inputStyle}>
          <option value="" disabled>
            Choose…
          </option>
          {question.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={name}
          type={question.fieldType === "number" ? "number" : "text"}
          name={name}
          required={question.required}
          style={inputStyle}
        />
      )}
    </div>
  );
}

function FieldLabel({ question, required }: { question: QuestionInput; required: boolean }) {
  return (
    <label htmlFor={`q_${question.id}`} style={labelStyle}>
      {question.label}
      {required && <span style={{ color: "#ef5a24" }}> *</span>}
    </label>
  );
}

function Shell({ tenantName, children }: { tenantName: string; children: React.ReactNode }) {
  return (
    <main style={shellStyle}>
      <div style={{ width: "100%", maxWidth: 480 }}>
        <p style={eyebrowStyle}>{tenantName}</p>
        {children}
      </div>
    </main>
  );
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const shellStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  background: "#0b0b0c",
  color: "#f5f3ef",
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: "56px 20px",
};
const eyebrowStyle: React.CSSProperties = {
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  fontSize: 11,
  opacity: 0.55,
  marginBottom: 10,
};
const titleStyle: React.CSSProperties = { fontSize: "clamp(24px,4vw,32px)", margin: 0, fontWeight: 600 };
const bodyTextStyle: React.CSSProperties = { opacity: 0.75, marginTop: 10, lineHeight: 1.55 };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13.5, marginBottom: 6, opacity: 0.85 };
const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 8,
  padding: "10px 12px",
  color: "#f5f3ef",
  fontSize: 14,
  outline: "none",
  fontFamily: "inherit",
};
const unsupportedNoteStyle: React.CSSProperties = { fontSize: 12.5, opacity: 0.6, margin: "4px 0 0" };
const errorStyle: React.CSSProperties = { color: "#f87171", fontSize: 13.5, margin: 0 };
const honeypotStyle: React.CSSProperties = { position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" };

function submitBtnStyle(submitting: boolean): React.CSSProperties {
  return {
    marginTop: 4,
    padding: "12px 20px",
    borderRadius: 8,
    border: "none",
    background: submitting ? "rgba(239,90,36,0.6)" : "#ef5a24",
    color: "#0b0b0c",
    fontWeight: 600,
    fontSize: 14.5,
    cursor: submitting ? "default" : "pointer",
  };
}
