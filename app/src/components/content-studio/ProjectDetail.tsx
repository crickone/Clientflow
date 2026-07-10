"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCw,
  AlertTriangle,
  Sparkles,
  Download,
  Save,
  Plus,
  Trash2,
  Type,
  Music,
  Scissors,
  Film,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Label } from "@/components/ui/Input";
import type { VideoAsset, VideoProject } from "@/lib/db/schema";
import { PlanTimelineEditor } from "@/components/content-studio/PlanTimelineEditor";

interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

interface Transcript {
  language: string;
  durationSeconds: number;
  text: string;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
}

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

const CAPTION_FONT_OPTIONS = [
  { name: "Arial Black", label: "Arial Black (default)" },
  { name: "Impact", label: "Impact" },
  { name: "Nebula", label: "Nebula (brand)" },
  { name: "Nebula Hollow", label: "Nebula Hollow (brand outline)" },
];

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

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Given a segment and its new freeform text, rebuild the word stream within
 * that segment's time range. If the token count matches the original, we
 * preserve word-level timings 1:1 (the common case: user fixed a typo).
 * Otherwise we distribute timings linearly across the segment's bounds.
 */
function reTokenizeSegmentWords(
  segStart: number,
  segEnd: number,
  newText: string,
  oldWords: TranscriptWord[],
): TranscriptWord[] {
  const tokens = newText
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return [];
  if (tokens.length === oldWords.length) {
    return tokens.map((t, i) => ({
      word: t,
      start: oldWords[i].start,
      end: oldWords[i].end,
    }));
  }
  const span = Math.max(segEnd - segStart, 0.2);
  const perWord = span / tokens.length;
  return tokens.map((t, i) => ({
    word: t,
    start: Number((segStart + i * perWord).toFixed(3)),
    end: Number((segStart + (i + 1) * perWord).toFixed(3)),
  }));
}

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
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingFont, setSavingFont] = useState(false);
  const [savingMusic, setSavingMusic] = useState(false);
  const [musicTracks, setMusicTracks] = useState<
    Array<{ filename: string; label: string }>
  >([]);
  const [volumeDraft, setVolumeDraft] = useState<number>(
    initialProject.musicVolume ?? 0.2,
  );
  const [introDurationDraft, setIntroDurationDraft] = useState<number>(
    initialProject.introDurationSec ?? 1.6,
  );
  const [editError, setEditError] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetch("/api/content-studio/music")
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok) setMusicTracks(data.tracks ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof project.musicVolume === "number") {
      setVolumeDraft(project.musicVolume);
    }
  }, [project.musicVolume]);

  useEffect(() => {
    if (typeof project.introDurationSec === "number") {
      setIntroDurationDraft(project.introDurationSec);
    }
  }, [project.introDurationSec]);

  const transcript: Transcript | null = useMemo(() => {
    if (!project.transcriptJson) return null;
    try {
      return JSON.parse(project.transcriptJson) as Transcript;
    } catch {
      return null;
    }
  }, [project.transcriptJson]);

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
  const [segmentDrafts, setSegmentDrafts] = useState<Record<number, string>>(
    {},
  );
  const [planDraft, setPlanDraft] = useState<PlanInsert[] | null>(null);
  const [selectedInsertIdx, setSelectedInsertIdx] = useState<number | null>(
    null,
  );
  /**
   * If auto-trim is on, the server tells us how long the rendered output
   * will be after silence is removed. The timeline uses this duration so
   * positions on the timeline = positions in the final output.
   */
  const [outputDurationSec, setOutputDurationSec] = useState<number | null>(
    null,
  );

  useEffect(() => {
    setSegmentDrafts({});
  }, [project.transcriptJson]);

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
            setOutputDurationSec(
              typeof data.outputDurationSec === "number"
                ? data.outputDurationSec
                : null,
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
      setOutputDurationSec(
        typeof fresh.outputDurationSec === "number"
          ? fresh.outputDurationSec
          : null,
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

  async function saveTranscriptEdits() {
    if (!transcript) return;
    setSavingTranscript(true);
    try {
      // Rebuild segments + words from drafts. Segments without drafts keep
      // their original text and word slices.
      const newSegments: TranscriptSegment[] = [];
      const newWords: TranscriptWord[] = [];
      for (const seg of transcript.segments) {
        const wordsInSeg = transcript.words.filter(
          (w) => w.start >= seg.start - 0.001 && w.start < seg.end + 0.001,
        );
        const draftText = segmentDrafts[seg.id];
        if (draftText !== undefined && draftText.trim() !== seg.text.trim()) {
          const rebuilt = reTokenizeSegmentWords(
            seg.start,
            seg.end,
            draftText,
            wordsInSeg,
          );
          newWords.push(...rebuilt);
          newSegments.push({
            ...seg,
            text: rebuilt.map((w) => w.word).join(" "),
          });
        } else {
          newWords.push(...wordsInSeg);
          newSegments.push(seg);
        }
      }
      // Any orphan words (timestamps outside every segment) — preserve them.
      const claimed = new Set(newWords.map((w) => `${w.start}-${w.word}`));
      for (const w of transcript.words) {
        if (!claimed.has(`${w.start}-${w.word}`)) {
          // Only re-add if no segment claimed this exact timestamp position.
          const claimedByTime = newWords.some(
            (nw) => Math.abs(nw.start - w.start) < 0.01,
          );
          if (!claimedByTime) newWords.push(w);
        }
      }
      newWords.sort((a, b) => a.start - b.start);

      const next: Transcript = {
        ...transcript,
        segments: newSegments,
        words: newWords,
        text: newSegments.map((s) => s.text).join(" "),
      };
      const ok = await patchProject({ transcript: next });
      if (ok) setSegmentDrafts({});
    } finally {
      setSavingTranscript(false);
    }
  }

  async function savePlanEdits() {
    if (!planDraft) return;
    setSavingPlan(true);
    try {
      await patchProject({ plan: { brollInserts: planDraft } });
    } finally {
      setSavingPlan(false);
    }
  }

  async function saveFont(font: string) {
    setSavingFont(true);
    try {
      await patchProject({ captionFont: font });
    } finally {
      setSavingFont(false);
    }
  }

  async function saveMusic(filename: string) {
    setSavingMusic(true);
    try {
      await patchProject({
        musicFilename: filename === "" ? null : filename,
      });
    } finally {
      setSavingMusic(false);
    }
  }

  async function saveMusicVolume(volume: number) {
    setSavingMusic(true);
    try {
      await patchProject({ musicVolume: volume });
    } finally {
      setSavingMusic(false);
    }
  }

  async function toggleTrim() {
    await patchProject({ autoTrimSilence: !project.autoTrimSilence });
  }

  async function toggleCards() {
    await patchProject({ showIntroOutro: !project.showIntroOutro });
  }

  async function saveIntroDuration(seconds: number) {
    await patchProject({ introDurationSec: seconds });
  }

  const status = STATUS_COPY[project.status];
  const brollAssets = assets.filter((a) => a.kind === "broll");
  const mainAsset = assets.find((a) => a.kind === "main") ?? null;
  const brollById = new Map(brollAssets.map((a) => [a.id, a]));

  const canRender =
    project.status === "transcribed" ||
    project.status === "rendered" ||
    (project.status === "failed" && project.transcriptJson);
  const hasPlan = !!plan;

  const hasTranscriptEdits = Object.keys(segmentDrafts).some((k) => {
    const id = Number(k);
    const seg = transcript?.segments.find((s) => s.id === id);
    return seg && segmentDrafts[id].trim() !== seg.text.trim();
  });

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

      {transcript && (
        <Section
          title={
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Type size={13} />
              Caption font
            </span>
          }
        >
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={project.captionFont ?? "Arial Black"}
              disabled={savingFont || busy}
              onChange={(e) => saveFont(e.target.value)}
              style={{
                background: "var(--bg)",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius)",
                padding: "10px 14px",
                color: "var(--text-primary)",
                fontSize: 14,
                outline: "none",
                fontFamily: "inherit",
                minWidth: 260,
              }}
            >
              {CAPTION_FONT_OPTIONS.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.label}
                </option>
              ))}
            </select>
            <span style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
              {savingFont
                ? "Saving…"
                : "Applies on next render."}
            </span>
          </div>
        </Section>
      )}

      {transcript && (
        <Section
          title={
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Music size={13} />
              Background music
            </span>
          }
        >
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={project.musicFilename ?? ""}
                disabled={savingMusic || busy}
                onChange={(e) => saveMusic(e.target.value)}
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--hairline)",
                  borderRadius: "var(--radius)",
                  padding: "10px 14px",
                  color: "var(--text-primary)",
                  fontSize: 14,
                  outline: "none",
                  fontFamily: "inherit",
                  minWidth: 260,
                }}
              >
                <option value="">No music</option>
                {musicTracks.map((t) => (
                  <option key={t.filename} value={t.filename}>
                    {t.label}
                  </option>
                ))}
              </select>
              {project.musicFilename && (
                <audio
                  key={project.musicFilename}
                  controls
                  src={`/api/content-studio/music/preview?file=${encodeURIComponent(
                    project.musicFilename,
                  )}`}
                  style={{ height: 36 }}
                />
              )}
              <span style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
                {savingMusic
                  ? "Saving…"
                  : musicTracks.length === 0
                    ? "Drop MP3s into app/data/music/ to populate this list."
                    : "Volume below applies on next render."}
              </span>
            </div>
            {project.musicFilename && (
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <label
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    minWidth: 60,
                  }}
                >
                  Volume
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={volumeDraft}
                  disabled={savingMusic || busy}
                  onChange={(e) => setVolumeDraft(Number(e.target.value))}
                  onPointerUp={() => {
                    if (Math.abs(volumeDraft - (project.musicVolume ?? 0.2)) > 0.001) {
                      saveMusicVolume(volumeDraft);
                    }
                  }}
                  onKeyUp={(e) => {
                    if (e.key.startsWith("Arrow")) {
                      if (Math.abs(volumeDraft - (project.musicVolume ?? 0.2)) > 0.001) {
                        saveMusicVolume(volumeDraft);
                      }
                    }
                  }}
                  style={{ flex: 1, minWidth: 200, maxWidth: 360 }}
                />
                <span
                  style={{
                    color: "var(--text-primary)",
                    fontSize: 13,
                    minWidth: 44,
                    textAlign: "right",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  {Math.round(volumeDraft * 100)}%
                </span>
                {project.status === "rendered" && !planEdited && (
                  <Button
                    variant="outline"
                    onClick={() => startRender(true)}
                    disabled={busy}
                  >
                    <RefreshCw size={13} />
                    Re-render
                  </Button>
                )}
              </div>
            )}
          </div>
        </Section>
      )}

      {transcript && (
        <Section title="Polish">
          <div style={{ display: "grid", gap: 10 }}>
            <ToggleRow
              icon={<Scissors size={14} />}
              label="Auto-trim silences"
              hint="Cuts long pauses down to a natural ~0.2s. Big perceived-quality boost on testimonials."
              checked={!!project.autoTrimSilence}
              onChange={toggleTrim}
              disabled={busy}
            />
            <ToggleRow
              icon={<Film size={14} />}
              label="Logo intro + outro card"
              hint="Fades your logo in over the start of the footage, and appends a 3s end card with site, phone and location."
              checked={!!project.showIntroOutro}
              onChange={toggleCards}
              disabled={busy}
            />
            {!!project.showIntroOutro && (
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "center",
                  flexWrap: "wrap",
                  padding: "10px 14px",
                  marginLeft: 28,
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--hairline)",
                  background: "var(--surface-1)",
                }}
              >
                <label
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    minWidth: 90,
                  }}
                >
                  Logo length
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={5}
                  step={0.1}
                  value={introDurationDraft}
                  disabled={busy}
                  onChange={(e) =>
                    setIntroDurationDraft(Number(e.target.value))
                  }
                  onPointerUp={() => {
                    if (
                      Math.abs(
                        introDurationDraft -
                          (project.introDurationSec ?? 1.6),
                      ) > 0.05
                    ) {
                      saveIntroDuration(introDurationDraft);
                    }
                  }}
                  onKeyUp={(e) => {
                    if (e.key.startsWith("Arrow")) {
                      if (
                        Math.abs(
                          introDurationDraft -
                            (project.introDurationSec ?? 1.6),
                        ) > 0.05
                      ) {
                        saveIntroDuration(introDurationDraft);
                      }
                    }
                  }}
                  style={{ flex: 1, minWidth: 180, maxWidth: 320 }}
                />
                <span
                  style={{
                    color: "var(--text-primary)",
                    fontSize: 13,
                    minWidth: 48,
                    textAlign: "right",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  {introDurationDraft.toFixed(1)}s
                </span>
              </div>
            )}
          </div>
        </Section>
      )}

      {plan && planDraft && (
        <Section
          title="B-roll plan"
          actions={
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                variant="outline"
                onClick={() =>
                  setPlanDraft([
                    ...planDraft,
                    {
                      startSec: planDraft.length
                        ? Math.min(
                            (transcript?.durationSeconds ?? 60) - 2,
                            Math.max(
                              ...planDraft.map((i) => i.endSec),
                            ) + 1,
                          )
                        : 2,
                      endSec: planDraft.length
                        ? Math.min(
                            transcript?.durationSeconds ?? 60,
                            Math.max(
                              ...planDraft.map((i) => i.endSec),
                            ) + 3.5,
                          )
                        : 4.5,
                      brollAssetId:
                        brollAssets.find(
                          (b) =>
                            !planDraft.some(
                              (p) => p.brollAssetId === b.id,
                            ),
                        )?.id ?? brollAssets[0]?.id ?? 0,
                      reason: "manual edit",
                      brollStartSec: 0,
                    },
                  ])
                }
                disabled={busy || savingPlan || brollAssets.length === 0}
              >
                <Plus size={13} />
                Add cutaway
              </Button>
              {planEdited && (
                <Button
                  onClick={savePlanEdits}
                  disabled={savingPlan || busy}
                >
                  <Save size={13} />
                  {savingPlan ? "Saving…" : "Save plan"}
                </Button>
              )}
            </div>
          }
        >
          {planDraft.length === 0 ? (
            <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
              No B-roll cutaways. Add one to overlay a clip at a specific moment.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <PlanTimelineEditor
                projectId={project.id}
                mainAsset={mainAsset}
                mainDurationSec={
                  project.autoTrimSilence && outputDurationSec
                    ? outputDurationSec
                    : (transcript?.durationSeconds ?? 60)
                }
                brollAssets={brollAssets}
                inserts={planDraft}
                onChange={(next) => setPlanDraft(next)}
                selectedIdx={selectedInsertIdx}
                onSelectIdx={setSelectedInsertIdx}
                renderedOutputFilename={
                  project.status === "rendered"
                    ? project.outputFilename
                    : null
                }
                outputAspectRatio={project.aspectRatio}
                hasIntroOutro={project.showIntroOutro}
                introDurationSec={project.introDurationSec}
                hasUnrenderedEdits={planEdited}
              />
              {(project.status === "rendered" ||
                project.status === "transcribed") &&
                !planEdited && (
                  <div style={{ marginTop: 4 }}>
                    <Button
                      variant="outline"
                      onClick={() => startRender(true)}
                      disabled={busy}
                    >
                      <RefreshCw size={13} />
                      {project.status === "rendered"
                        ? "Re-render with this plan"
                        : "Render with this plan"}
                    </Button>
                  </div>
                )}
              {planEdited && (
                <div
                  style={{
                    color: "var(--text-tertiary)",
                    fontSize: 12,
                    marginTop: 4,
                  }}
                >
                  Save the plan, then click Re-render to apply your edits.
                </div>
              )}
            </div>
          )}
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

      {transcript && (
        <Section
          title={`Transcript · ${transcript.language?.toUpperCase()} · ${formatSeconds(
            transcript.durationSeconds,
          )}`}
          actions={
            hasTranscriptEdits ? (
              <Button
                onClick={saveTranscriptEdits}
                disabled={savingTranscript || busy}
              >
                <Save size={13} />
                {savingTranscript ? "Saving…" : "Save edits"}
              </Button>
            ) : null
          }
        >
          <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginBottom: 12 }}>
            Edit the text below to fix typos. Word timings stay aligned when the
            word count is unchanged; otherwise they redistribute evenly across
            the segment.
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {transcript.segments.map((seg) => {
              const draft = segmentDrafts[seg.id];
              const value = draft !== undefined ? draft : seg.text.trim();
              const changed =
                draft !== undefined && draft.trim() !== seg.text.trim();
              return (
                <div
                  key={seg.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "64px 1fr",
                    gap: 12,
                    alignItems: "start",
                  }}
                >
                  <span
                    style={{
                      color: "var(--text-tertiary)",
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 12,
                      paddingTop: 12,
                    }}
                  >
                    {formatSeconds(seg.start)}
                  </span>
                  <Textarea
                    value={value}
                    onChange={(e) =>
                      setSegmentDrafts((prev) => ({
                        ...prev,
                        [seg.id]: e.target.value,
                      }))
                    }
                    style={{
                      minHeight: 48,
                      fontSize: 14,
                      borderColor: changed ? "#2c6ce0" : "var(--hairline)",
                    }}
                  />
                </div>
              );
            })}
          </div>
        </Section>
      )}
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
