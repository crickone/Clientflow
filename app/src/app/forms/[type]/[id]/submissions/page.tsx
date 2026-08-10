import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import { getForm, getFormSubmissions } from "@/lib/forms";
import { FORM_TYPE_META, type FormType } from "@/lib/formsModel";

export const dynamic = "force-dynamic";

const VALID = new Set(Object.keys(FORM_TYPE_META));

export default async function FormSubmissionsPage({ params }: { params: { type: string; id: string } }) {
  await requireUser();
  if (!VALID.has(params.type)) notFound();
  const type = params.type as FormType;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const form = getForm(id);
  if (!form || form.type !== type) notFound();

  const submissions = getFormSubmissions(id);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Forms"
        title={`${form.title || "Untitled form"} — Submissions`}
        subtitle={`${submissions.length} submission${submissions.length === 1 ? "" : "s"}`}
        actions={
          <Link href={`/forms/${type}/${id}`} style={backLinkStyle}>
            ← Back to form
          </Link>
        }
      />

      {submissions.length === 0 ? (
        <div style={emptyStyle}>No submissions yet. Share the form&apos;s link to start collecting them.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {submissions.map((s) => (
            <div key={s.id} style={cardStyle}>
              <div style={cardHeadStyle}>
                <div style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>
                  {s.submitterName || s.submitterEmail || "Anonymous"}
                  {s.submitterName && s.submitterEmail && (
                    <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}> · {s.submitterEmail}</span>
                  )}
                </div>
                <div style={timestampStyle}>{fmtDate(s.createdAt)}</div>
              </div>
              {s.answers.length === 0 ? (
                <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: 0 }}>No answers recorded.</p>
              ) : (
                <dl style={dlStyle}>
                  {s.answers.map((a) => (
                    <div key={a.questionId} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <dt style={dtStyle}>{a.label}</dt>
                      <dd style={ddStyle}>{a.value || <span style={{ opacity: 0.4 }}>—</span>}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString("en-IE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const backLinkStyle: React.CSSProperties = { fontSize: 13, color: "var(--accent-ink)" };
const emptyStyle: React.CSSProperties = {
  padding: "40px 16px",
  textAlign: "center",
  color: "var(--text-tertiary)",
  fontSize: 13.5,
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
};
const cardStyle: React.CSSProperties = {
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  background: "var(--surface-1)",
  padding: 18,
};
const cardHeadStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 12,
  paddingBottom: 12,
  borderBottom: "1px solid var(--hairline)",
  flexWrap: "wrap",
};
const timestampStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--text-tertiary)",
  fontFamily: "var(--font-mono), monospace",
};
const dlStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: 14,
  margin: 0,
};
const dtStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--text-tertiary)",
};
const ddStyle: React.CSSProperties = { fontSize: 13.5, color: "var(--text-primary)", margin: 0, wordBreak: "break-word" };
