"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { saveFormAction } from "@/app/forms/actions";
import type { FormInput, FormTypeMeta } from "@/lib/formsModel";

export function TermsBuilder({ initial, meta }: { initial: FormInput; meta: FormTypeMeta }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content ?? "");
  const [saving, start] = useTransition();

  const save = () => {
    if (!title.trim()) return toast.error("Enter a title.");
    start(async () => {
      const res = await saveFormAction({ ...initial, title, content: content || null, questions: [] });
      if (res.ok) {
        toast.success("Terms saved.");
        router.push("/forms/terms");
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button variant="ghost" size="icon" onClick={() => router.push("/forms/terms")} aria-label="Back">
          <ArrowLeft size={16} />
        </Button>
        <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: 22, textTransform: "uppercase" }}>{meta.builderTitle}</h1>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, border: "1px solid var(--hairline)", borderRadius: "var(--radius)", background: "var(--surface-1)", padding: 24 }}>
        <div>
          <Label htmlFor="tc-title">Title *</Label>
          <Input id="tc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Coaching Terms & Conditions" autoFocus />
        </div>
        <div>
          <Label htmlFor="tc-content">Terms &amp; conditions</Label>
          <Textarea id="tc-content" value={content} onChange={(e) => setContent(e.target.value)} rows={16} placeholder="Enter the terms your clients agree to when they join…" />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={() => router.push("/forms/terms")} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save & Close"}</Button>
        </div>
      </div>
    </div>
  );
}
