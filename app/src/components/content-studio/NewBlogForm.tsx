"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { useVocab } from "@/components/providers/VocabProvider";
import type { Therapy, VideoProject } from "@/lib/db/schema";

type Mode = "prompt" | "therapy" | "video";

interface Props {
  therapies: Therapy[];
  videoProjects: Array<
    Pick<VideoProject, "id" | "name" | "status">
  >;
}

export function NewBlogForm({ therapies, videoProjects }: Props) {
  const router = useRouter();
  const vocab = useVocab();
  const [mode, setMode] = useState<Mode>("prompt");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState("");
  const [targetWords, setTargetWords] = useState(700);
  const [therapyId, setTherapyId] = useState<number | null>(
    therapies[0]?.id ?? null,
  );
  const [videoProjectId, setVideoProjectId] = useState<number | null>(
    videoProjects[0]?.id ?? null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (mode === "therapy" && !therapyId) {
      setError(`Pick a ${vocab.service.toLowerCase()}.`);
      return;
    }
    if (mode === "video" && !videoProjectId) {
      setError("Pick a video to repurpose.");
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        title: title.trim(),
        inputMode: mode,
        prompt: prompt.trim() || null,
        tone: tone.trim() || null,
        targetWords,
        sourceTherapyId: mode === "therapy" ? therapyId : null,
        sourceVideoProjectId: mode === "video" ? videoProjectId : null,
      };
      const res = await fetch("/api/content-studio/blogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Couldn't start generation.");
      }
      router.push(`/content-studio/blogs/${json.postId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start generation.");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: "grid", gap: 24, maxWidth: 720 }}
    >
      <div>
        <Label>Source</Label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <ModeOption
            label="Topic prompt"
            description="Type a topic. Claude writes it."
            active={mode === "prompt"}
            onClick={() => setMode("prompt")}
          />
          <ModeOption
            label={`${vocab.service} focus`}
            description={`Pick a ${vocab.service.toLowerCase()}. Pulls business context.`}
            active={mode === "therapy"}
            onClick={() => setMode("therapy")}
          />
          <ModeOption
            label="From video"
            description="Repurpose a Content Studio transcript."
            active={mode === "video"}
            onClick={() => setMode("video")}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          required
          value={title}
          placeholder="e.g. What your first session actually feels like"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {mode === "therapy" && (
        <div>
          <Label>{vocab.service}</Label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {therapies.map((t) => {
              const active = therapyId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTherapyId(t.id)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: "var(--radius)",
                    border: active
                      ? "1px solid var(--text-primary)"
                      : "1px solid var(--hairline)",
                    background: active ? "var(--surface-2)" : "var(--bg)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontFamily: "inherit",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: "var(--radius)",
                      background: t.colourHex,
                      marginRight: 8,
                      verticalAlign: "middle",
                    }}
                  />
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {mode === "video" && (
        <div>
          <Label>Video project</Label>
          {videoProjects.length === 0 ? (
            <div
              style={{
                fontSize: 13,
                color: "var(--text-tertiary)",
                padding: "10px 14px",
                border: "1px dashed var(--hairline)",
                borderRadius: "var(--radius)",
              }}
            >
              No video projects yet. Upload one in the Videos tab first.
            </div>
          ) : (
            <select
              value={videoProjectId ?? ""}
              onChange={(e) => setVideoProjectId(Number(e.target.value))}
              style={{
                width: "100%",
                background: "var(--bg)",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius)",
                padding: "10px 14px",
                color: "var(--text-primary)",
                fontSize: 14,
                fontFamily: "inherit",
              }}
            >
              {videoProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.id} — {p.name}
                  {p.status !== "transcribed" &&
                  p.status !== "rendered" &&
                  p.status !== "planning" &&
                  p.status !== "rendering"
                    ? `  ·  ${p.status}`
                    : ""}
                </option>
              ))}
            </select>
          )}
          <div
            style={{
              fontSize: 11,
              color: "var(--text-tertiary)",
              marginTop: 6,
              letterSpacing: "0.04em",
            }}
          >
            We pull the Whisper transcript and let Claude restructure it.
          </div>
        </div>
      )}

      <div>
        <Label htmlFor="prompt">
          {mode === "prompt" ? "Topic / brief" : "Angle (optional)"}
        </Label>
        <Textarea
          id="prompt"
          required={mode === "prompt"}
          value={prompt}
          placeholder={
            mode === "prompt"
              ? "e.g. Cover what it is, how it works, who it suits, and what to expect."
              : "e.g. Frame it for people who are nervous about their first session."
          }
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <Label htmlFor="tone">Tone (optional)</Label>
          <Input
            id="tone"
            value={tone}
            placeholder="e.g. calm, grounded, no hype"
            onChange={(e) => setTone(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="words">Target length (words)</Label>
          <Input
            id="words"
            type="number"
            min={200}
            max={2500}
            value={targetWords}
            onChange={(e) => setTargetWords(Number(e.target.value))}
          />
        </div>
      </div>

      {error && <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 12,
          paddingTop: 8,
        }}
      >
        <Button type="submit" disabled={submitting || !title}>
          <Sparkles size={15} />
          {submitting ? "Starting…" : "Generate blog"}
        </Button>
      </div>
    </form>
  );
}

function ModeOption({
  label,
  description,
  active,
  onClick,
}: {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "12px 14px",
        borderRadius: "var(--radius)",
        border: active
          ? "1px solid var(--text-primary)"
          : "1px solid var(--hairline)",
        background: active ? "var(--surface-2)" : "var(--bg)",
        cursor: "pointer",
        fontFamily: "inherit",
        display: "grid",
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "var(--text-primary)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--text-tertiary)",
          letterSpacing: "0.02em",
        }}
      >
        {description}
      </div>
    </button>
  );
}
