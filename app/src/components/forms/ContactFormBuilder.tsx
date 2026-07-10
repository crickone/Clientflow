"use client";

import { useState, useTransition } from "react";
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

export function ContactFormBuilder({ initial, meta }: { initial: FormInput; meta: FormTypeMeta }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [status, setStatus] = useState(initial.status);
  const [trigger, setTrigger] = useState(initial.triggerStatus);
  const [questions, setQuestions] = useState<QuestionInput[]>(
    initial.id ? initial.questions : SUGGESTIONS.contact.map(suggestionToQuestion),
  );
  const [saving, start] = useTransition();

  const patch = (i: number, p: Partial<QuestionInput>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...p } : q)));
  const remove = (i: number) => setQuestions((qs) => qs.filter((_, j) => j !== i));
  const add = () => setQuestions((qs) => [...qs, blankQuestion("main")]);

  const save = () => {
    if (!title.trim()) return toast.error("Enter a form title.");
    start(async () => {
      const res = await saveFormAction({ ...initial, title, status, triggerStatus: trigger, questions });
      if (res.ok) {
        toast.success("Contact form saved.");
        router.push("/forms/contact");
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button variant="ghost" size="icon" onClick={() => router.push("/forms/contact")} aria-label="Back">
          <ArrowLeft size={16} />
        </Button>
        <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: 22, textTransform: "uppercase" }}>{meta.builderTitle}</h1>
      </div>

      <div style={card}>
        <div>
          <Label htmlFor="cf-title">Form title *</Label>
          <Input id="cf-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. New client enquiry" autoFocus />
        </div>

        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <ToggleRow label="Status" hint="Form is live and accepting submissions" on={status} onClick={() => setStatus((v) => !v)} />
          <ToggleRow label="Trigger status" hint="Fire the 'new lead' automation on submit" on={trigger} onClick={() => setTrigger((v) => !v)} />
        </div>

        <div>
          <Label>Fields</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
            {questions.map((q, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr auto", gap: 10, alignItems: "center" }}>
                <Input value={q.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder="Field label" />
                <select value={q.fieldType} onChange={(e) => patch(i, { fieldType: e.target.value as FieldType })} style={selectStyle}>
                  {FIELD_TYPES.map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>
                <button onClick={() => remove(i)} aria-label="Remove" style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer" }}>
                  <X size={16} />
                </button>
              </div>
            ))}
            <div>
              <Button variant="outline" size="sm" onClick={add}>
                <Plus size={14} /> Add a field
              </Button>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
          A public share link is generated on save — copy it from the Contact Forms list.
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={() => router.push("/forms/contact")} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save & Close"}</Button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, hint, on, onClick }: { label: string; hint: string; on: boolean; onClick: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{label}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{hint}</div>
      </div>
      <Switch on={on} onClick={onClick} />
    </div>
  );
}

const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 18,
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  background: "var(--surface-1)",
  padding: 24,
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
