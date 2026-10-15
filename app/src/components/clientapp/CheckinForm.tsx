"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2, X } from "lucide-react";

import type { QuestionInput } from "@/lib/formsModel";
import { photoNames } from "@/lib/memberChoicesModel";
import { shrink } from "@/components/clientapp/shrinkPhoto";
import { submitCheckinAction } from "@/app/app/actions";

/**
 * The member's weekly check-in: the business's Check-in form, with photos
 * uploaded as they're added (up to three per question). Video questions are
 * skipped here.
 */
export function CheckinForm({ questions }: { questions: QuestionInput[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = questions.filter((q) => q.id != null && q.fieldType !== "video");
  const set = (k: string, v: string) => {
    setError(null);
    setValues((x) => ({ ...x, [k]: v }));
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await submitCheckinAction(values);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push("/app/checkin?sent=1");
      router.refresh();
    });
  }

  return (
    <form className="ag" onSubmit={submit}>
      <div className="ag-qs">
        {shown.map((q) => {
          const k = `q_${q.id}`;
          if (q.fieldType === "photo") return <PhotoQuestion key={k} q={q} value={values[k] ?? ""} onChange={(v) => set(k, v)} />;
          if (q.fieldType === "confirm") {
            const on = values[k] === "yes";
            return (
              <div key={k} className="ag-item" data-on={on}>
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
              </div>
            );
          }
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
                <input
                  className="ag-input"
                  inputMode={q.fieldType === "number" || q.fieldType === "metric" ? "decimal" : undefined}
                  value={values[k] ?? ""}
                  onChange={(e) => set(k, e.target.value)}
                  required={q.required}
                  maxLength={500}
                />
              )}
            </label>
          );
        })}
      </div>

      {error && (
        <div className="ag-error" role="alert">
          {error}
        </div>
      )}

      <button type="submit" className="ag-go" disabled={pending}>
        {pending ? <Loader2 size={18} className="spin" /> : null} {pending ? "Sending" : "Send check-in"}
      </button>
    </form>
  );
}

function PhotoQuestion({ q, value, onChange }: { q: QuestionInput; value: string; onChange: (v: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const names = photoNames(value);

  async function add(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", await shrink(file), "checkin.jpg");
      const res = await fetch("/api/app/checkins/photo", { method: "POST", body: form });
      const j = (await res.json()) as { ok: boolean; name?: string; error?: string };
      if (!j.ok || !j.name) setErr(j.error ?? "Couldn't add that photo.");
      else onChange([...names, j.name].join("|"));
    } catch {
      setErr("Couldn't add that photo. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ag-q">
      <span>
        {q.label}
        {q.required && <em aria-label="required"> *</em>}
      </span>
      <div className="ci-photos">
        {names.map((n) => (
          <div key={n} className="ci-photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/app/checkins/photo?name=${encodeURIComponent(n)}`} alt="" />
            <button type="button" aria-label="Remove photo" onClick={() => onChange(names.filter((x) => x !== n).join("|"))}>
              <X size={14} />
            </button>
          </div>
        ))}
        {names.length < 3 && (
          <button type="button" className="ci-add" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 size={18} className="spin" /> : <Camera size={18} />}
            <span>{busy ? "Adding" : "Add photo"}</span>
          </button>
        )}
      </div>
      {err && <span className="ag-error">{err}</span>}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void add(f);
        }}
      />
    </div>
  );
}
