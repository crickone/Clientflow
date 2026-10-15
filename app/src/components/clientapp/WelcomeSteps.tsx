"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, FileText, Loader2, X } from "lucide-react";

import { DocText } from "@/components/agreements/DocText";
import type { AgreementDoc } from "@/lib/agreementsModel";
import type { QuestionInput } from "@/lib/formsModel";
import { acceptAgreementsAction, submitWelcomeAction } from "@/app/app/actions";

/**
 * Step one: tick each document (open any to read it in full). The health
 * consent is short enough to read on the tick box itself.
 */
export function AgreeStep({ docs, businessName, step }: { docs: AgreementDoc[]; businessName: string; step: string | null }) {
  const router = useRouter();
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<AgreementDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const all = docs.every((d) => ticked[d.key]);

  function submit() {
    setError(null);
    start(async () => {
      const r = await acceptAgreementsAction(docs.map((d) => ({ key: d.key, version: d.version })));
      if (!r.ok) {
        setError(r.error);
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="ag">
      <header className="ag-head">
        {step && <span className="ag-step">{step}</span>}
        <h1>Before you start</h1>
        <p>Read and agree to these to use {businessName}&rsquo;s app. Tap a document to read it in full.</p>
      </header>

      <ul className="ag-list">
        {docs.map((d) => {
          const short = d.key === "platform:health";
          return (
            <li key={d.key} className="ag-item" data-on={Boolean(ticked[d.key])}>
              {!short && (
                <button type="button" className="ag-open" onClick={() => setOpen(d)}>
                  <span className="ag-icon" aria-hidden>
                    <FileText size={17} />
                  </span>
                  <span className="ag-open-text">
                    <b>{d.title}</b>
                    <span>{d.summary}</span>
                  </span>
                  <ChevronRight size={17} aria-hidden />
                </button>
              )}
              <label className="ag-tick">
                <input type="checkbox" checked={Boolean(ticked[d.key])} onChange={(e) => setTicked({ ...ticked, [d.key]: e.target.checked })} />
                <span className="ag-box" aria-hidden>
                  <Check size={14} />
                </span>
                <span>{short ? d.body.split("\n\n")[0] : `I have read and agree to the ${d.title.toLowerCase().startsWith("terms") ? d.title : d.title.charAt(0).toLowerCase() + d.title.slice(1)}.`}</span>
              </label>
            </li>
          );
        })}
      </ul>

      {error && (
        <div className="ag-error" role="alert">
          {error}
        </div>
      )}

      <button type="button" className="ag-go" onClick={submit} disabled={!all || pending}>
        {pending ? <Loader2 size={18} className="spin" /> : null} {pending ? "Saving" : all ? "Agree and continue" : `Tick all ${docs.length} to continue`}
      </button>

      {open && (
        <DocSheet
          doc={open}
          onClose={() => setOpen(null)}
          onAgree={() => {
            setTicked({ ...ticked, [open.key]: true });
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}

function DocSheet({ doc, onClose, onAgree }: { doc: AgreementDoc; onClose: () => void; onAgree: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div className="ag-sheet" role="dialog" aria-modal="true" aria-label={doc.title}>
      <div className="ag-sheet-head">
        <b>{doc.title}</b>
        <button type="button" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="ag-sheet-body">
        <DocText body={doc.body} />
      </div>
      <div className="ag-sheet-foot">
        <button type="button" className="ag-go" onClick={onAgree}>
          I agree
        </button>
      </div>
    </div>
  );
}

/** Step two: the business's Welcome Q&A. Uploads aren't taken here; tick-to-confirm lines are. */
export function WelcomeStep({ title, questions, businessName, step }: { title: string; questions: QuestionInput[]; businessName: string; step: string | null }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = questions.filter((q) => q.id != null && q.fieldType !== "photo" && q.fieldType !== "video");
  const set = (k: string, v: string) => setValues((x) => ({ ...x, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await submitWelcomeAction(values);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push("/app");
      router.refresh();
    });
  }

  const asks = shown.filter((q) => q.fieldType !== "confirm");
  const confirms = shown.filter((q) => q.fieldType === "confirm");

  return (
    <form className="ag" onSubmit={submit}>
      <header className="ag-head">
        {step && <span className="ag-step">{step}</span>}
        <h1>{title || "Welcome"}</h1>
        <p>A few questions so {businessName} can look after you. Only they see your answers.</p>
      </header>

      <div className="ag-qs">
        {asks.map((q) => {
          const k = `q_${q.id}`;
          return (
            <label key={k} className="ag-q">
              <span>
                {q.label}
                {q.required && <em aria-label="required"> *</em>}
              </span>
              {q.fieldType === "long" ? (
                <textarea className="ag-input" rows={3} value={values[k] ?? ""} onChange={(e) => set(k, e.target.value)} required={q.required} maxLength={5000} />
              ) : q.fieldType === "dropdown" ? (
                <select className="ag-input" value={values[k] ?? ""} onChange={(e) => set(k, e.target.value)} required={q.required}>
                  <option value="">Choose</option>
                  {q.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="ag-input" inputMode={q.fieldType === "number" || q.fieldType === "metric" ? "decimal" : undefined} value={values[k] ?? ""} onChange={(e) => set(k, e.target.value)} required={q.required} maxLength={500} />
              )}
            </label>
          );
        })}
      </div>

      {confirms.length > 0 && (
        <ul className="ag-list">
          {confirms.map((q) => {
            const k = `q_${q.id}`;
            const on = values[k] === "yes";
            return (
              <li key={k} className="ag-item" data-on={on}>
                <label className="ag-tick">
                  <input type="checkbox" checked={on} onChange={(e) => set(k, e.target.checked ? "yes" : "")} />
                  <span className="ag-box" aria-hidden>
                    <Check size={14} />
                  </span>
                  <span>
                    {q.label}
                    {q.required && <em aria-label="required"> *</em>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <div className="ag-error" role="alert">
          {error}
        </div>
      )}

      <button type="submit" className="ag-go" disabled={pending}>
        {pending ? <Loader2 size={18} className="spin" /> : null} {pending ? "Saving" : "Finish"}
      </button>
    </form>
  );
}
