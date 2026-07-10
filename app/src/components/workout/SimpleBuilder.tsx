"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { saveProgramAction } from "@/app/workout/actions";
import type { ProgramInput } from "@/lib/workoutModel";

export function SimpleBuilder({ initial }: { initial: ProgramInput }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title === "New Program" ? "" : initial.title);
  const [tagsText, setTagsText] = useState(initial.tags.join(", "));
  const [summary, setSummary] = useState(initial.summary ?? "");
  const [content, setContent] = useState(initial.content ?? "");
  const [saving, start] = useTransition();

  const submit = (close: boolean) => {
    if (!title.trim()) return toast.error("Enter a program title.");
    if (!content.trim()) return toast.error("Add some workout content.");
    start(async () => {
      const res = await saveProgramAction({
        ...initial,
        title,
        tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
        summary: summary || null,
        content: content || null,
      });
      if (res.ok) {
        toast.success("Program saved.");
        if (close) router.push("/workout");
        else router.replace(`/workout/${res.id}`);
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button variant="ghost" size="icon" onClick={() => router.push("/workout")} aria-label="Back">
          <ArrowLeft size={16} />
        </Button>
        <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: 24, textTransform: "uppercase" }}>
          {initial.id ? "Edit" : "Create a"} Program
        </h1>
      </div>

      <div style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <Label htmlFor="sp-title">Program title *</Label>
            <Input id="sp-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter program title" autoFocus />
          </div>
          <div>
            <Label htmlFor="sp-tags">Tags</Label>
            <Input id="sp-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="Add tags (comma separated)" />
          </div>
        </div>
        <div>
          <Label htmlFor="sp-summary">Workout summary</Label>
          <Textarea id="sp-summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="Enter workout summary" />
        </div>
        <div>
          <Label htmlFor="sp-content">Workout content *</Label>
          <Textarea id="sp-content" value={content} onChange={(e) => setContent(e.target.value)} rows={12} placeholder="Type or paste the workout…" />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <Button variant="ghost" onClick={() => router.push("/workout")} disabled={saving}>
          Cancel
        </Button>
        <Button variant="outline" onClick={() => submit(false)} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button onClick={() => submit(true)} disabled={saving}>
          Save &amp; Close
        </Button>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  background: "var(--surface-1)",
  padding: 22,
};
