"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  Sparkles,
  Download,
  Scissors,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { VideoAsset, VideoProject } from "@/lib/db/schema";

interface PlanInsert {
  startSec: number;
  endSec: number;
  brollAssetId: number;
  reason: string;
  brollStartSec?: number;
}

interface CutPlan {
  brollInserts: PlanInsert[];
}

const STATUS_COPY: Record<
  VideoProject["status"],
  { label: string; tone: string; hint: string }
> = {
  queued: {
    label: "Queued",
    tone: "var(--text-secondary)",
    hint: "Waiting to start.",
  },
  transcribing: {
    label: "Transcribing",
    tone: "#2c6ce0",
    hint: "Extracting audio and sending to Whisper. Usually under a minute for a 60s clip.",
  },
  transcribed: {
    label: "Transcribed",
    tone: "#15803d",
    hint: "Word-level transcript ready. Generate a plan, review the B-roll picks, then render.",
  },
  planning: {
    label: "Planning cuts",
    tone: "#7c3aed",
    hint: "Claude is reading the transcript and picking where B-roll should drop in. You'll be able to review before rendering.",
  },
  rendering: {
    label: "Rendering",
    tone: "#7c3aed",
    hint: "ffmpeg is burning captions, overlaying B-roll, and exporting the MP4. Roughly 2-4× clip length.",
  },
  rendered: {
    label: "Rendered",
    tone: "#15803d",
    hint: "Your reel is ready. Tweak captions or B-roll positions and re-render anytime.",
  },
  failed: {
    label: "Failed",
    tone: "#dc2626",
    hint: "Something went wrong. See the error below and retry.",
  },
};

export function ProjectDetail({
  initialProject,
  initialAssets,
}: {
  initialProject: VideoProject;
  initialAssets: VideoAsset[];
}) {
  const [project, setProject] = useState(initialProject);
  const [assets, setAssets] = useState(initialAssets);
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Once a transcript exists, the CapCut-style NLE is the SINGLE editor for this
  // project. Hand off to it — page.tsx re-routes this same URL to VideoEditor on
  // refresh. This retires the old post-transcript ProjectDetail surface (and its
  // b-roll plan editor, whose edits the render silently ignored once the NLE had
  // written a timeline). The poll above brings transcriptJson into state the
  // moment transcription finishes, firing this.
  const router = useRouter();
  useEffect(() => {
    if (project.transcriptJson) router.refresh();
  }, [project.transcriptJson, router]);

  const plan: CutPlan | null = useMemo(() => {
    if (!project.planJson) return null;
    try {
      return JSON.parse(project.planJson) as CutPlan;
    } catch {
      return null;
    }
  }, [project.planJson]);

  // Local drafts. We mirror server state on load and reset when the underlying
  // JSON changes (e.g. after re-render).
  const [planDraft, setPlanDraft] = useState<PlanInsert[] | null>(null);

  useEffect(() => {
    setPlanDraft(plan ? plan.brollInserts.map((i) => ({ ...i })) : null);
  }, [project.planJson, plan]);

  useEffect(() => {
    function poll() {
      fetch(`/api/content-studio/projects/${project.id}`)
        .then((r) => r.json())
        .then((data) => {
          if (data?.ok) {
            setProject({
              ...data.project,
              createdAt: new Date(data.project.createdAt),
              updatedAt: new Date(data.project.updatedAt),
            });
            setAssets(
              data.assets.map((a: VideoAsset) => ({
                ...a,
                createdAt: new Date(a.createdAt),
              })),
            );
          }
        })
        .catch(() => {});
    }

    const active =
      project.status === "queued" ||
      project.status === "transcribing" ||
      project.status === "planning" ||
      project.status === "rendering";
    if (active) {
      pollingRef.current = setInterval(poll, 2500);
      return () => {
        if (pollingRef.current) clearInterval(pollingRef.current);
      };
    }
    return undefined;
  }, [project.id, project.status]);

  async function refreshProject() {
    const fresh = await fetch(
      `/api/content-studio/projects/${project.id}`,
    ).then((r) => r.json());
    if (fresh?.ok) {
      setProject({
        ...fresh.project,
        createdAt: new Date(fresh.project.createdAt),
        updatedAt: new Date(fresh.project.updatedAt),
      });
      setAssets(
        fresh.assets.map((a: VideoAsset) => ({
          ...a,
          createdAt: new Date(a.createdAt),
        })),
      );
    }
  }

  async function retryTranscribe() {
    setBusy(true);
    try {
      await fetch(`/api/content-studio/projects/${project.id}/transcribe`, {
        method: "POST",
      });
      await refreshProject();
    } finally {
      setBusy(false);
    }
  }

  async function startRender(useSavedPlan: boolean) {
    setBusy(true);
    setEditError(null);
    try {
      await fetch(`/api/content-studio/projects/${project.id}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useSavedPlan }),
      });
      await refreshProject();
    } finally {
      setBusy(false);
    }
  }

  async function startPlan() {
    setBusy(true);
    setEditError(null);
    try {
      await fetch(`/api/content-studio/projects/${project.id}/plan`, {
        method: "POST",
      });
      await refreshProject();
    } finally {
      setBusy(false);
    }
  }

  async function rotateAsset(assetId: number, currentRotation: number) {
    const next = (((currentRotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270;
    setEditError(null);
    try {
      const res = await fetch(
        `/api/content-studio/projects/${project.id}/assets/${assetId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rotation: next }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Couldn't update rotation.");
      }
      setAssets((prev) =>
        prev.map((a) =>
          a.id === assetId ? { ...a, rotation: data.asset.rotation } : a,
        ),
      );
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "Couldn't update rotation.",
      );
    }
  }

  async function patchProject(body: Record<string, unknown>): Promise<boolean> {
    setEditError(null);
    const res = await fetch(`/api/content-studio/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      setEditError(data.error ?? "Save failed.");
      return false;
    }
    setProject({
      ...data.project,
      createdAt: new Date(data.project.createdAt),
      updatedAt: new Date(data.project.updatedAt),
    });
    setAssets(
      data.assets.map((a: VideoAsset) => ({
        ...a,
        createdAt: new Date(a.createdAt),
      })),
    );
    return true;
  }

  async function toggleTrim() {
    await patchProject({ autoTrimSilence: !project.autoTrimSilence });
  }

  const status = STATUS_COPY[project.status];

  const canRender =
    project.status === "transcribed" ||
    project.status === "rendered" ||
    (project.status === "failed" && project.transcriptJson);
  const hasPlan = !!plan;

  const planEdited = (() => {
    if (!plan || !planDraft) return false;
    if (plan.brollInserts.length !== planDraft.length) return true;
    return plan.brollInserts.some((ins, i) => {
      const d = planDraft[i];
      return (
        !d ||
        d.startSec !== ins.startSec ||
        d.endSec !== ins.endSec ||
        d.brollAssetId !== ins.brollAssetId ||
        (d.brollStartSec ?? 0) !== (ins.brollStartSec ?? 0)
      );
    });
  })();

  // Transcript ready → the NLE takes over (the router.refresh above re-routes
  // this URL to VideoEditor). Show a brief hand-off state instead of the legacy
  // post-transcript sections while that navigation resolves.
  if (project.transcriptJson) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          padding: "64px 20px",
          background: "var(--surface-1)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          textAlign: "center",
        }}
      >
        <Loader2 size={22} className="spin" style={{ color: "var(--text-secondary)" }} />
        <div style={{ fontSize: 15, fontWeight: 600 }}>Transcription complete</div>
        <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
          Opening your editor…
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div
        style={{
          background: "var(--bg)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          padding: 20,
          boxShadow: "var(--shadow-1)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: status.tone,
              }}
            >
              {status.label}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {project.status !== "transcribing" &&
              project.status !== "planning" &&
              project.status !== "rendering" && (
                <Button
                  onClick={retryTranscribe}
                  disabled={busy}
                  variant="outline"
                  title="Re-run Whisper transcription on the main clip"
                >
                  <RefreshCw size={14} />
                  {busy
                    ? "Working…"
                    : project.transcriptJson
                      ? "Re-transcribe"
                      : "Retry transcribe"}
                </Button>
              )}
            {canRender && (
              <Button
                onClick={startPlan}
                disabled={busy}
                variant={hasPlan ? "outline" : undefined}
              >
                <Sparkles size={14} />
                {busy
                  ? "Starting…"
                  : hasPlan
                    ? "Re-plan"
                    : "Generate plan"}
              </Button>
            )}
            {canRender && hasPlan && !planEdited && (
              <Button onClick={() => startRender(true)} disabled={busy}>
                <RefreshCw size={14} />
                {project.status === "rendered" ? "Re-render" : "Render"}
              </Button>
            )}
          </div>
        </div>
        <div style={{ color: "var(--text-secondary)", fontSize: 14 }}>
          {status.hint}
        </div>
        {project.error && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: "var(--radius)",
              background: "rgba(220,38,38,0.06)",
              border: "1px solid rgba(220,38,38,0.25)",
              color: "#b91c1c",
              fontSize: 13,
              display: "flex",
              gap: 8,
            }}
          >
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{project.error}</span>
          </div>
        )}
        {editError && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: "var(--radius)",
              background: "rgba(220,38,38,0.06)",
              border: "1px solid rgba(220,38,38,0.25)",
              color: "#b91c1c",
              fontSize: 13,
            }}
          >
            {editError}
          </div>
        )}
      </div>

      <Section title="First cut">
        <ToggleRow
          icon={<Scissors size={14} />}
          label="Auto-trim silences"
          hint="Cuts long pauses down to a natural ~0.2s in the first cut, before you open the editor. You can still fine-tune every clip afterwards."
          checked={!!project.autoTrimSilence}
          onChange={toggleTrim}
          disabled={busy}
        />
      </Section>

      {project.status === "rendered" && project.outputFilename && (
        <Section title="Output">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
            }}
          >
            <video
              key={project.outputFilename}
              controls
              playsInline
              src={`/api/content-studio/projects/${project.id}/output?v=${encodeURIComponent(
                project.outputFilename ?? "",
              )}`}
              style={{
                maxWidth: project.aspectRatio === "9:16" ? 360 : 480,
                width: "100%",
                borderRadius: "var(--radius)",
                background: "#000",
                aspectRatio: project.aspectRatio === "9:16" ? "9 / 16" : "1 / 1",
              }}
            />
            <a
              href={`/api/content-studio/projects/${project.id}/output?download=1&v=${encodeURIComponent(
                project.outputFilename ?? "",
              )}`}
              download
            >
              <Button variant="outline">
                <Download size={14} />
                Download MP4
              </Button>
            </a>
          </div>
        </Section>
      )}

      <Section title="Assets">
        <div style={{ display: "grid", gap: 8 }}>
          {assets.map((a) => (
            <div
              key={a.id}
              style={{
                display: "flex",
                gap: 12,
                padding: "10px 14px",
                borderRadius: "var(--radius)",
                border: "1px solid var(--hairline)",
                background: "var(--surface-1)",
                fontSize: 13,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color:
                    a.kind === "main"
                      ? "var(--text-primary)"
                      : "var(--text-tertiary)",
                  alignSelf: "center",
                  width: 56,
                }}
              >
                {a.kind}
              </span>
              <span style={{ color: "var(--text-primary)", flex: 1 }}>
                {a.originalName}
              </span>
              <span style={{ color: "var(--text-tertiary)" }}>
                {a.durationSeconds
                  ? `${a.durationSeconds.toFixed(1)}s`
                  : "—"}{" "}
                · {(a.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                {a.width && a.height ? ` · ${a.width}×${a.height}` : ""}
              </span>
              <button
                type="button"
                onClick={() => rotateAsset(a.id, a.rotation ?? 0)}
                title="Rotate this clip 90° clockwise (applied at next render)"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  background: "var(--bg)",
                  border: "1px solid var(--hairline)",
                  borderRadius: "var(--radius)",
                  padding: "4px 10px",
                  fontSize: 12,
                  color:
                    (a.rotation ?? 0) === 0
                      ? "var(--text-secondary)"
                      : "var(--text-primary)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <RotateCw size={12} />
                {(a.rotation ?? 0) === 0 ? "Rotate" : `${a.rotation}°`}
              </button>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 12,
        alignItems: "center",
        padding: "10px 14px",
        borderRadius: "var(--radius)",
        border: "1px solid var(--hairline)",
        background: checked ? "var(--surface-2)" : "var(--surface-1)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span
        style={{
          color: checked ? "var(--text-primary)" : "var(--text-tertiary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: "var(--radius)",
          background: checked ? "var(--bg)" : "transparent",
        }}
      >
        {icon}
      </span>
      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 500 }}>
          {label}
        </span>
        <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
          {hint}
        </span>
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        style={{ width: 18, height: 18, cursor: disabled ? "default" : "pointer" }}
      />
    </label>
  );
}

function Section({
  title,
  actions,
  children,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: 20,
        boxShadow: "var(--shadow-1)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: "var(--text-tertiary)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          {title}
        </div>
        {actions && <div>{actions}</div>}
      </div>
      {children}
    </div>
  );
}
