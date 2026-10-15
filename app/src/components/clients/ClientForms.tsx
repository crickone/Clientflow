"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, ChevronDown, FileCheck2, ClipboardList } from "lucide-react";

import { summariseForm } from "@/lib/formSummaryModel";
import type { FieldType } from "@/lib/formsModel";

interface FormCard {
  id: number;
  title: string;
  at: number;
  answers: { questionId: number; label: string; fieldType: FieldType; value: string }[];
}

interface DocRow {
  key: string;
  title: string;
  acceptedAt: number | null;
  current: boolean;
}

function day(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
}

/**
 * The forms a member has done in the app, one card each: done or not, when,
 * and what's worth a look. Answers stay folded away until opened.
 */
export function ClientForms({ clientId, forms, docs }: { clientId: number; forms: FormCard[]; docs: DocRow[] }) {
  const signed = docs.filter((d) => d.current).length;
  const allSigned = docs.length > 0 && signed === docs.length;

  return (
    <div className="cf">
      {docs.length > 0 && (
        <section className="cf-card">
          <div className="cf-head cf-head--static">
            <span className="cf-icon" data-tone={allSigned ? "ok" : "todo"} aria-hidden>
              <FileCheck2 size={18} />
            </span>
            <span className="cf-title">
              <b>Terms and documents</b>
              <span>{allSigned ? `All ${docs.length} signed` : `${signed} of ${docs.length} signed`}</span>
            </span>
            <span className="cf-status" data-tone={allSigned ? "ok" : "todo"}>
              {allSigned ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
              {allSigned ? "Signed" : "Waiting"}
            </span>
          </div>
          <ul className="cf-docs">
            {docs.map((d) => (
              <li key={d.key}>
                <span>{d.title}</span>
                {d.acceptedAt === null ? (
                  <em>Not yet</em>
                ) : (
                  <Link href={`/clients/${clientId}/agreements/${encodeURIComponent(d.key)}`}>{d.current ? day(d.acceptedAt) : "Older version"}</Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {forms.map((f) => (
        <FormCardView key={f.id} f={f} />
      ))}

      {forms.length === 0 && docs.length === 0 && (
        <div className="bs-empty">
          <p>No forms done in the app yet.</p>
          <p className="bs-muted">
            Switched-on Terms &amp; Conditions and the Default questionnaire are asked when a member opens the app. Set them up under <Link href="/forms/terms">Forms</Link>.
          </p>
        </div>
      )}
    </div>
  );
}

function FormCardView({ f }: { f: FormCard }) {
  const [open, setOpen] = useState(false);
  const s = summariseForm(f.answers);
  const shown = f.answers.filter((a) => a.fieldType !== "video");
  const asks = shown.filter((a) => a.fieldType !== "confirm");
  const confirms = shown.filter((a) => a.fieldType === "confirm");

  return (
    <section className="cf-card" data-open={open}>
      <button type="button" className="cf-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="cf-icon" data-tone="ok" aria-hidden>
          <ClipboardList size={18} />
        </span>
        <span className="cf-title">
          <b>{f.title}</b>
          <span>
            Completed {day(f.at)} · {s.answered} of {s.questions} answered
            {s.confirms.total ? ` · ${s.confirms.ticked} of ${s.confirms.total} ticked` : ""}
          </span>
        </span>
        <span className="cf-status" data-tone="ok">
          <CircleCheck size={15} /> Done
        </span>
        <ChevronDown size={16} className="cf-chev" aria-hidden />
      </button>

      {s.yes.length > 0 && (
        <div className="cf-flags">
          <CircleAlert size={14} aria-hidden />
          <span>
            Answered <b>Yes</b> to: {s.yes.join("; ")}
          </span>
        </div>
      )}

      {open && (
        <div className="cf-body">
          <dl className="cf-answers">
            {asks.map((a) => (
              <div key={a.questionId} data-yes={a.fieldType === "dropdown" && /^\s*yes\b/i.test(a.value)}>
                <dt>{a.label}</dt>
                <dd>{a.fieldType === "photo" ? (a.value ? "Photo added" : "No photo") : a.value.trim() || <em>No answer</em>}</dd>
              </div>
            ))}
          </dl>
          {confirms.length > 0 && (
            <ul className="cf-confirms">
              {confirms.map((a) => (
                <li key={a.questionId} data-on={a.value === "yes"}>
                  {a.value === "yes" ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
                  <span>{a.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
