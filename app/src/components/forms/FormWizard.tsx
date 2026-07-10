"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Switch } from "@/components/forms/FormsListView";
import { saveFormAction } from "@/app/forms/actions";
import {
  blankQuestion,
  FIELD_TYPES,
  SUGGESTIONS,
  suggestionToQuestion,
  type FieldType,
  type FormInput,
  type FormTypeMeta,
  type QuestionInput,
} from "@/lib/formsModel";

const STEPS = ["Set up", "Add additional questions", "Preview", "Save & publish"];

export function FormWizard({ initial, meta }: { initial: FormInput; meta: FormTypeMeta }) {
  const router = useRouter();
  const [step, setStep] = useState(initial.id ? 3 : 1);
  const [title, setTitle] = useState(initial.title);
  const [questions, setQuestions] = useState<QuestionInput[]>(initial.questions);
  const [addMore, setAddMore] = useState<boolean | null>(null);
  const [saving, start] = useTransition();

  const suggestions = SUGGESTIONS[meta.key];
  const suggestionLabels = useMemo(() => new Set(suggestions.map((s) => `${s.section}::${s.label}`)), [suggestions]);
  const bySection = useMemo(() => {
    const m = new Map<string, typeof suggestions>();
    for (const s of suggestions) {
      const arr = m.get(s.section) ?? [];
      arr.push(s);
      m.set(s.section, arr);
    }
    return m;
  }, [suggestions]);

  const hasQ = (section: string, label: string) => questions.some((q) => q.section === section && q.label === label);
  const toggleSuggestion = (section: string, label: string) => {
    if (hasQ(section, label)) {
      setQuestions((qs) => qs.filter((q) => !(q.section === section && q.label === label)));
    } else {
      const s = suggestions.find((x) => x.section === section && x.label === label);
      if (s) setQuestions((qs) => [...qs, suggestionToQuestion(s)]);
    }
  };
  const toggleAll = (section: string, on: boolean) => {
    const secSug = bySection.get(section) ?? [];
    if (on) {
      setQuestions((qs) => {
        const missing = secSug.filter((s) => !qs.some((q) => q.section === s.section && q.label === s.label));
        return [...qs, ...missing.map(suggestionToQuestion)];
      });
    } else {
      setQuestions((qs) => qs.filter((q) => !secSug.some((s) => s.section === q.section && s.label === q.label)));
    }
  };

  const customQuestions = questions.filter((q) => !suggestionLabels.has(`${q.section}::${q.label}`));
  const primarySection = meta.sections.find((s) => s.key !== "progress")?.key ?? "main";
  const addCustom = () => setQuestions((qs) => [...qs, blankQuestion(primarySection)]);
  const patchQuestion = (idx: number, patch: Partial<QuestionInput>) =>
    setQuestions((qs) => qs.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  const removeQuestion = (idx: number) => setQuestions((qs) => qs.filter((_, i) => i !== idx));

  const next = () => {
    if (step === 1 && !title.trim()) return toast.error(`Enter a ${meta.label.toLowerCase()} title.`);
    setStep((s) => Math.min(4, s + 1));
  };
  const prev = () => setStep((s) => Math.max(1, s - 1));

  const publish = () => {
    if (!title.trim()) return toast.error("Enter a title.");
    start(async () => {
      const res = await saveFormAction({
        ...initial,
        title,
        questions,
        status: true,
      });
      if (res.ok) {
        toast.success("Saved & published.");
        router.push(`/forms/${meta.key}`);
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button variant="ghost" size="icon" onClick={() => router.push(`/forms/${meta.key}`)} aria-label="Back">
          <ArrowLeft size={16} />
        </Button>
        <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: 22, textTransform: "uppercase" }}>{meta.builderTitle}</h1>
      </div>

      {/* stepper */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {STEPS.map((s, i) => {
          const n = i + 1;
          const active = n === step;
          const done = n < step;
          return (
            <button
              key={s}
              onClick={() => setStep(n)}
              style={{ textAlign: "left", background: "transparent", border: "none", cursor: "pointer", paddingBottom: 8, borderBottom: `2px solid ${active ? "var(--accent)" : "var(--hairline)"}` }}
            >
              <span style={{ fontSize: 18, fontFamily: "var(--font-heading), sans-serif", color: active || done ? "var(--accent-ink)" : "var(--text-tertiary)", marginRight: 6 }}>{n}.</span>
              <span style={{ fontSize: 13, color: active ? "var(--text-primary)" : "var(--text-tertiary)" }}>{s}</span>
            </button>
          );
        })}
      </div>

      <div style={card}>
        {step === 1 && (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>Set up your {meta.label.toLowerCase()}</div>
            <ul style={{ margin: "4px 0 8px 18px", color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
              {meta.intro.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
            <div>
              <Label htmlFor="fw-title">Title</Label>
              <Input id="fw-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Enter ${meta.label.toLowerCase()} title`} autoFocus />
            </div>
            {meta.sections.map((sec) => {
              const secSug = bySection.get(sec.key) ?? [];
              if (secSug.length === 0) return null;
              const allOn = secSug.every((s) => hasQ(s.section, s.label));
              return (
                <div key={sec.key} style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", padding: "6px 0" }}>{sec.label}</div>
                  <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
                    {secSug.map((s) => (
                      <label key={s.label} style={checkRow}>
                        <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)" }}>{s.label}</span>
                        <input type="checkbox" checked={hasQ(s.section, s.label)} onChange={() => toggleSuggestion(s.section, s.label)} style={{ width: 17, height: 17 }} />
                      </label>
                    ))}
                    <label style={{ ...checkRow, borderBottom: "none" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-secondary)" }}>Add all</span>
                      <input type="checkbox" checked={allOn} onChange={(e) => toggleAll(sec.key, e.target.checked)} style={{ width: 17, height: 17 }} />
                    </label>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>Add additional questions?</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Do you want to add any additional questions?</div>
            <div style={{ display: "flex", gap: 10 }}>
              <Button variant={addMore === true ? undefined : "outline"} onClick={() => setAddMore(true)}>Yes</Button>
              <Button variant={addMore === false ? undefined : "outline"} onClick={() => setAddMore(false)}>No</Button>
            </div>
            {addMore && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
                {customQuestions.map((q) => {
                  const idx = questions.indexOf(q);
                  return (
                    <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Input value={q.label} onChange={(e) => patchQuestion(idx, { label: e.target.value })} placeholder="Enter your question…" />
                      <button onClick={() => removeQuestion(idx)} aria-label="Remove" style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer" }}>
                        <X size={16} />
                      </button>
                    </div>
                  );
                })}
                <div>
                  <Button variant="outline" size="sm" onClick={addCustom}>
                    <Plus size={14} /> Add a question
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>Preview your {meta.label.toLowerCase()}</div>
            <ul style={{ margin: "4px 0 8px 18px", color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
              <li>Set the field type for each question and mark any as required.</li>
            </ul>
            {questions.length === 0 && <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>No questions yet — go back and add some.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {questions.map((q, idx) =>
                q.isMetric ? (
                  <div key={idx} style={metricRow}>
                    <span style={{ fontSize: 13.5, color: "var(--text-primary)" }}>{q.label}</span>
                    <input type="checkbox" checked onChange={() => removeQuestion(idx)} style={{ width: 17, height: 17 }} title="Uncheck to remove" />
                  </div>
                ) : (
                  <div key={idx} style={qCard}>
                    <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr auto auto", gap: 12, alignItems: "end" }}>
                      <div>
                        <Label>What question would you like to ask?</Label>
                        <Input value={q.label} onChange={(e) => patchQuestion(idx, { label: e.target.value })} />
                      </div>
                      <div>
                        <Label>What do you want to receive?</Label>
                        <select value={q.fieldType} onChange={(e) => patchQuestion(idx, { fieldType: e.target.value as FieldType })} style={selectStyle}>
                          {FIELD_TYPES.map((f) => (
                            <option key={f.key} value={f.key}>{f.label}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <Label>Required</Label>
                        <div style={{ display: "flex", justifyContent: "center", height: 40, alignItems: "center" }}>
                          <Switch on={q.required} onClick={() => patchQuestion(idx, { required: !q.required })} />
                        </div>
                      </div>
                      <button onClick={() => removeQuestion(idx)} aria-label="Remove" style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer", height: 40 }}>
                        <X size={16} />
                      </button>
                    </div>
                    {q.fieldType === "dropdown" && (
                      <div style={{ marginTop: 10 }}>
                        <Label>Options</Label>
                        <OptionsInput value={q.options} onChange={(options) => patchQuestion(idx, { options })} />
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>
            <div>
              <Button variant="outline" size="sm" onClick={addCustom}>
                <Plus size={14} /> Add a question
              </Button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>Save &amp; publish</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Click <strong>Save &amp; Publish</strong> to create this {meta.label.toLowerCase()}. It will have {questions.length} question{questions.length === 1 ? "" : "s"}.
            </div>
          </>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Button variant="ghost" onClick={step === 1 ? () => router.push(`/forms/${meta.key}`) : prev} disabled={saving}>
          {step === 1 ? "Cancel" : "Previous"}
        </Button>
        {step < 4 ? (
          <Button onClick={next}>Next</Button>
        ) : (
          <Button onClick={publish} disabled={saving}>{saving ? "Saving…" : "Save & Publish"}</Button>
        )}
      </div>
    </div>
  );
}

function OptionsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setText("");
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: "6px 8px", background: "var(--surface-1)" }}>
      {value.map((o) => (
        <span key={o} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, background: "rgba(34,197,94,0.14)", color: "#22c55e", padding: "2px 8px", borderRadius: 5 }}>
          {o}
          <button onClick={() => onChange(value.filter((x) => x !== o))} aria-label={`Remove ${o}`} style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", display: "inline-flex" }}>
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder="type…"
        style={{ flex: 1, minWidth: 80, border: "none", outline: "none", background: "transparent", color: "var(--text-primary)", fontSize: 13 }}
      />
    </div>
  );
}

const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  background: "var(--surface-1)",
  padding: 24,
};
const checkRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 14px",
  borderBottom: "1px solid var(--hairline)",
  cursor: "pointer",
};
const metricRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 14px",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
};
const qCard: React.CSSProperties = {
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  padding: 14,
  background: "var(--surface-2)",
};
const selectStyle: React.CSSProperties = {
  width: "100%",
  height: 40,
  padding: "0 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 13,
};
