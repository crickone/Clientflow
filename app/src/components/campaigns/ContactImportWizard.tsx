"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, FileUp, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import {
  dedupeKey,
  mapRow,
  parseCsv,
  parseTags,
  suggestMapping,
  validateRow,
  CONTACT_FIELD_LABELS,
  CONTACT_FIELDS,
  type ContactColumnMapping,
  type ContactField,
  type ParsedCsv,
} from "@/lib/marketing/contactImport";
import { importContactsAction, type ContactImportResult } from "@/app/campaigns/contacts/import/actions";

type RowStatus = "new" | "duplicate" | "suppressed" | "invalid";
const PREVIEW_LIMIT = 100;

export function ContactImportWizard({
  existingEmails,
  suppressedEmails,
}: {
  existingEmails: string[];
  suppressedEmails: string[];
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ContactColumnMapping>({});
  const [importing, startImport] = useTransition();
  const [result, setResult] = useState<ContactImportResult | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const p = parseCsv(text);
    if (p.headers.length === 0 || p.rows.length === 0) {
      toast.error("Couldn't read any rows from that file.");
      return;
    }
    setFileName(file.name);
    setCsvText(text);
    setParsed(p);
    setMapping(suggestMapping(p.headers));
    setStep(2);
  };

  const setField = (field: ContactField, value: string) =>
    setMapping((prev) => {
      const next = { ...prev };
      if (value === "") delete next[field];
      else next[field] = Number(value);
      return next;
    });

  const emailMapped = mapping.email !== undefined;

  // ── preview: validate + dedupe (mirrors the server; existing/suppressed
  // emails are props computed server-side) ──
  const preview = useMemo(() => {
    if (!parsed) return null;
    const emailSet = new Set(existingEmails);
    const suppressedSet = new Set(suppressedEmails);
    let nNew = 0;
    let nDup = 0;
    let nSuppressed = 0;
    let nInvalid = 0;
    const view = parsed.rows.map((row) => {
      const m = mapRow(row, mapping);
      const v = validateRow(m);
      let status: RowStatus;
      if (!v.ok) {
        status = "invalid";
        nInvalid++;
      } else {
        const key = dedupeKey(m);
        if (key && suppressedSet.has(key)) {
          status = "suppressed";
          nSuppressed++;
        } else if (key && emailSet.has(key)) {
          status = "duplicate";
          nDup++;
        } else {
          status = "new";
          nNew++;
          if (key) emailSet.add(key);
        }
      }
      return { m, status, warnings: v.warnings, errors: v.errors, tags: parseTags(m.tags) };
    });
    return { view, nNew, nDup, nSuppressed, nInvalid, total: parsed.rows.length };
  }, [parsed, mapping, existingEmails, suppressedEmails]);

  const runImport = () =>
    startImport(async () => {
      const res = await importContactsAction({ csvText, mapping });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setResult(res);
      setStep(4);
    });

  return (
    <div style={{ maxWidth: 900 }}>
      <Stepper step={step} />

      {/* ── Step 1: upload ── */}
      {step === 1 && (
        <div style={card}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFile(e.dataTransfer.files?.[0]);
            }}
            style={dropzone}
          >
            <FileUp size={28} color="var(--accent)" />
            <div style={{ fontSize: 15, color: "var(--text-primary)", fontWeight: 500 }}>
              Drop a CSV here, or click to choose
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", textAlign: "center", maxWidth: 460, lineHeight: 1.5 }}>
              Exports from Mailchimp, GoHighLevel, HubSpot and most CRMs work. Comma, tab or
              semicolon separated. We&apos;ll map the columns in the next step.
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
              hidden
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </div>
        </div>
      )}

      {/* ── Step 2: map columns ── */}
      {step === 2 && parsed && (
        <div style={card}>
          <SectionTitle>Map your columns</SectionTitle>
          <p style={hint}>
            <strong>{fileName}</strong> · {parsed.headers.length} columns · {parsed.rows.length} rows.
            We&apos;ve guessed the mapping — adjust anything that looks off.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
            {CONTACT_FIELDS.map((field) => (
              <div key={field} style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 12, alignItems: "center" }}>
                <label htmlFor={`map-${field}`} style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>
                  {CONTACT_FIELD_LABELS[field]}
                  {field === "email" && <span style={{ color: "var(--accent)" }}> *</span>}
                </label>
                <select
                  id={`map-${field}`}
                  value={mapping[field] ?? ""}
                  onChange={(e) => setField(field, e.target.value)}
                  style={select}
                >
                  <option value="">— Skip —</option>
                  {parsed.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {!emailMapped && <Warn>Map an email column to continue — contacts need an email address.</Warn>}

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button size="sm" onClick={() => setStep(3)} disabled={!emailMapped} style={{ marginLeft: "auto" }}>
              Preview
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: preview + validate ── */}
      {step === 3 && preview && (
        <div style={card}>
          <SectionTitle>Preview</SectionTitle>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "2px 0 6px" }}>
            <Stat tone="good" label={`${preview.nNew} new`} />
            <Stat tone="muted" label={`${preview.nDup} duplicate`} />
            <Stat tone="info" label={`${preview.nSuppressed} suppressed`} />
            <Stat tone="bad" label={`${preview.nInvalid} invalid`} />
          </div>
          <p style={hint}>
            Duplicates (already in your contacts) and suppressed addresses (previously
            unsubscribed, bounced or complained) are skipped, along with invalid rows. Showing
            the first {Math.min(PREVIEW_LIMIT, preview.total)} of {preview.total}.
          </p>

          <div style={{ overflowX: "auto", border: "1px solid var(--hairline)", borderRadius: "var(--radius)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  {["Status", "Email", "Name", "Phone", "Tags"].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.view.slice(0, PREVIEW_LIMIT).map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--hairline)" }}>
                    <td style={td}>
                      <StatusPill status={r.status} />
                    </td>
                    <td style={td}>{r.m.email || <Dim>—</Dim>}</td>
                    <td style={td}>{r.m.name || <Dim>—</Dim>}</td>
                    <td style={td}>{r.m.phone || <Dim>—</Dim>}</td>
                    <td style={td}>{r.tags.length ? r.tags.join(", ") : <Dim>—</Dim>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button size="sm" onClick={runImport} loading={importing} disabled={preview.nNew === 0} style={{ marginLeft: "auto" }}>
              <Upload size={14} /> Import {preview.nNew} contact{preview.nNew === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 4: done ── */}
      {step === 4 && result && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <CheckCircle2 size={22} color="#22c55e" />
            <SectionTitle>Import complete</SectionTitle>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "4px 0 8px" }}>
            <Stat tone="good" label={`${result.inserted} imported`} />
            <Stat tone="muted" label={`${result.duplicates} duplicates skipped`} />
            <Stat tone="info" label={`${result.suppressedSkipped} suppressed skipped`} />
            <Stat tone="bad" label={`${result.invalid} invalid skipped`} />
          </div>

          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 14, marginTop: 6, display: "flex", gap: 8 }}>
            <Link href="/campaigns/contacts">
              <Button size="sm">Done</Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ── small presentational bits ─────────────────────────────────────────────────

function Stepper({ step }: { step: number }) {
  const labels = ["Upload", "Map columns", "Preview", "Done"];
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
      {labels.map((label, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12.5,
              color: active ? "var(--text-primary)" : done ? "var(--text-secondary)" : "var(--text-tertiary)",
            }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                fontSize: 11,
                background: active ? "var(--accent)" : done ? "rgba(34,197,94,0.16)" : "var(--surface-2)",
                color: active ? "#0a0a0c" : done ? "#22c55e" : "var(--text-tertiary)",
                border: "1px solid var(--hairline)",
              }}
            >
              {done ? "✓" : n}
            </span>
            {label}
            {n < labels.length && <span style={{ color: "var(--text-tertiary)", marginLeft: 2 }}>›</span>}
          </div>
        );
      })}
    </div>
  );
}

function StatusPill({ status }: { status: RowStatus }) {
  const map = {
    new: { bg: "rgba(34,197,94,0.14)", fg: "#22c55e", label: "New" },
    duplicate: { bg: "rgba(255,255,255,0.06)", fg: "var(--text-tertiary)", label: "Duplicate" },
    suppressed: { bg: "rgba(96,165,250,0.14)", fg: "#60a5fa", label: "Suppressed" },
    invalid: { bg: "rgba(239,68,68,0.14)", fg: "#f87171", label: "Invalid" },
  }[status];
  return (
    <span style={{ display: "inline-block", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.04em", padding: "2px 7px", borderRadius: 5, background: map.bg, color: map.fg }}>
      {map.label}
    </span>
  );
}

function Stat({ label, tone }: { label: string; tone: "good" | "bad" | "muted" | "info" }) {
  const c = {
    good: { bg: "rgba(34,197,94,0.12)", fg: "#22c55e" },
    bad: { bg: "rgba(239,68,68,0.12)", fg: "#f87171" },
    muted: { bg: "var(--surface-2)", fg: "var(--text-secondary)" },
    info: { bg: "rgba(96,165,250,0.12)", fg: "#60a5fa" },
  }[tone];
  return (
    <span style={{ fontSize: 12.5, fontWeight: 500, padding: "4px 10px", borderRadius: 7, background: c.bg, color: c.fg }}>
      {label}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{children}</div>;
}
function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12, fontSize: 12.5, color: "#fbbf24", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)", padding: "8px 12px", borderRadius: "var(--radius)" }}>
      {children}
    </div>
  );
}
function Dim({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--text-tertiary)" }}>{children}</span>;
}

const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  background: "var(--surface-1)",
  padding: 20,
};
const dropzone: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: "48px 24px",
  border: "1.5px dashed var(--hairline)",
  borderRadius: "var(--radius)",
  cursor: "pointer",
  background: "var(--surface-2)",
};
const hint: React.CSSProperties = { fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.55, margin: 0 };
const select: React.CSSProperties = {
  height: 36,
  padding: "0 10px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 13,
};
const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--text-tertiary)",
  background: "var(--surface-2)",
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = { padding: "7px 10px", color: "var(--text-secondary)", whiteSpace: "nowrap" };
