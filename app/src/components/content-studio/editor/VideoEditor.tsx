"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Undo2, Download, AlertTriangle, Plus, RotateCw, RotateCcw, Loader2 } from "lucide-react";
import { GenerateBrollDialog } from "./GenerateBrollDialog";

import { Button } from "@/components/ui/Button";
import type { VideoAsset, VideoProject } from "@/lib/db/schema";
import type { Transcript } from "@/lib/ai/transcribe";
import type { TimelineDoc } from "@/lib/video/timeline";
import {
  addBroll,
  deleteSegment,
  outputDuration,
  remapBrollSourceToOutput,
  splitSegment,
} from "@/lib/video/timeline";
import type { AspectRatio } from "@/lib/video/captionPhrases";
import { PreviewStage, type PreviewHandle } from "./PreviewStage";
import { Timeline } from "./Timeline";
import { Inspector } from "./Inspector";
import type { Selection } from "./types";

interface Props {
  initialProject: VideoProject;
  initialAssets: VideoAsset[];
  initialTimeline: TimelineDoc;
  /** Whether `initialTimeline` was already saved (vs synthesized on load). */
  timelinePersisted: boolean;
  transcript: Transcript;
  captionFonts: Array<{ name: string; label: string }>;
}

const API = (id: number) => `/api/content-studio/projects/${id}`;

export function VideoEditor({
  initialProject,
  initialAssets,
  initialTimeline,
  timelinePersisted,
  transcript: initialTranscript,
  captionFonts,
}: Props) {
  const projectId = initialProject.id;
  const [project, setProject] = useState(initialProject);
  const [assets, setAssets] = useState(initialAssets);
  const [timeline, setTimeline] = useState<TimelineDoc>(initialTimeline);
  const [transcript, setTranscript] = useState(initialTranscript);
  const [selection, setSelection] = useState<Selection>(null);
  const [playhead, setPlayhead] = useState(0);
  const [undoStack, setUndoStack] = useState<TimelineDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const clipInputRef = useRef<HTMLInputElement | null>(null);
  const [musicTracks, setMusicTracks] = useState<Array<{ filename: string; label: string }>>([]);

  const previewRef = useRef<PreviewHandle>(null);
  const mainAsset = assets.find((a) => a.kind === "main") ?? null;
  const brollAssets = assets.filter((a) => a.kind === "broll");
  const mainSourceDuration = mainAsset?.durationSeconds ?? transcript.durationSeconds ?? 60;

  useEffect(() => {
    fetch("/api/content-studio/music")
      .then((r) => r.json())
      .then((d) => d?.ok && setMusicTracks(d.tracks ?? []))
      .catch(() => {});
  }, []);

  // First-cut bake: if the timeline was synthesized on load (not yet saved),
  // persist it once so the editor, preview and renders all agree from the start.
  useEffect(() => {
    if (timelinePersisted) return;
    fetch(API(projectId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeline: initialTimeline }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── autosave (debounced) ────────────────────────────────────────────────
  const savedTimelineRef = useRef(JSON.stringify(initialTimeline));
  useEffect(() => {
    const json = JSON.stringify(timeline);
    if (json === savedTimelineRef.current) return;
    const t = setTimeout(() => {
      savedTimelineRef.current = json;
      // Autosave is best-effort. Failures here are transient (e.g. a 409 while
      // a render is in flight); the authoritative save happens via
      // flushTimeline() before export, so we stay quiet rather than flashing a
      // banner on every keystroke.
      fetch(API(projectId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeline }),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [timeline, projectId]);

  const savedTranscriptRef = useRef(JSON.stringify(initialTranscript));
  useEffect(() => {
    const json = JSON.stringify(transcript);
    if (json === savedTranscriptRef.current) return;
    const t = setTimeout(() => {
      savedTranscriptRef.current = json;
      fetch(API(projectId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [transcript, projectId]);

  // ── edit + undo ──────────────────────────────────────────────────────────
  const applyChange = useCallback((next: TimelineDoc) => {
    setUndoStack((s) => [...s.slice(-49), timelineSnapshotRef.current]);
    setTimeline(next);
  }, []);
  // keep a ref of the latest timeline so undo can snapshot the pre-change value
  const timelineSnapshotRef = useRef(timeline);
  useEffect(() => {
    timelineSnapshotRef.current = timeline;
  }, [timeline]);

  const undo = useCallback(() => {
    setUndoStack((s) => {
      if (s.length === 0) return s;
      const prev = s[s.length - 1];
      setTimeline(prev);
      return s.slice(0, -1);
    });
    setSelection(null);
  }, []);

  const onScrub = useCallback((sec: number) => {
    previewRef.current?.seekTo(sec);
  }, []);

  const onSplit = useCallback(() => {
    applyChange(splitSegment(timelineSnapshotRef.current, playhead));
  }, [applyChange, playhead]);

  const onDeleteSegment = useCallback(
    (index: number) => {
      applyChange(deleteSegment(timelineSnapshotRef.current, index));
      setSelection(null);
    },
    [applyChange],
  );

  const onAddBrollAtPlayhead = useCallback(
    (assetId: number) => {
      const doc = timelineSnapshotRef.current;
      const total = outputDuration(doc.mainSegments);
      const len = Math.min(3, Math.max(0.5, total));
      const start = Math.max(0, Math.min(playhead, total - len));
      applyChange(
        addBroll(doc, { startSec: start, endSec: start + len, brollAssetId: assetId, brollStartSec: 0 }),
      );
    },
    [applyChange, playhead],
  );

  // ── status polling (during AI runs / render) ─────────────────────────────
  const refresh = useCallback(async () => {
    const d = await fetch(API(projectId)).then((r) => r.json());
    if (d?.ok) {
      setProject({ ...d.project, createdAt: new Date(d.project.createdAt), updatedAt: new Date(d.project.updatedAt) });
      setAssets(d.assets.map((a: VideoAsset) => ({ ...a, createdAt: new Date(a.createdAt) })));
      if (d.project.transcriptJson) {
        try {
          setTranscript(JSON.parse(d.project.transcriptJson));
          savedTranscriptRef.current = d.project.transcriptJson;
        } catch {}
      }
    }
    return d?.project?.status as VideoProject["status"] | undefined;
  }, [projectId]);

  const pollUntilIdle = useCallback(async () => {
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const status = await refresh();
      if (status && !["transcribing", "planning", "rendering", "queued"].includes(status)) {
        return status;
      }
    }
    return undefined;
  }, [refresh]);

  const flushTimeline = useCallback(async () => {
    savedTimelineRef.current = JSON.stringify(timelineSnapshotRef.current);
    await fetch(API(projectId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeline: timelineSnapshotRef.current }),
    });
  }, [projectId]);

  const onPatchFields = useCallback(
    async (patch: Record<string, unknown>) => {
      setProject((p) => ({ ...p, ...patch }) as VideoProject);
      const d = await fetch(API(projectId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then((r) => r.json());
      if (!d.ok) setError(d.error ?? "Couldn't save.");
    },
    [projectId],
  );

  /**
   * Apply a confirmed orientation to the main clip. Footage shot with the
   * camera turned on its side has no rotation metadata, so `suggestedRotation`
   * is only ever a proposal — this is what commits the operator's choice to
   * `rotation` (what the renderer and preview actually use). Clearing the
   * suggestion dismisses the banner.
   */
  const onSetMainRotation = useCallback(
    async (rotation: number) => {
      if (!mainAsset) return;
      setBusy(true);
      setError(null);
      try {
        const d = await fetch(`${API(projectId)}/assets/${mainAsset.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rotation, suggestedRotation: 0 }),
        }).then((r) => r.json());
        if (!d.ok) {
          setError(d.error ?? "Couldn't rotate the clip.");
          return;
        }
        setAssets((prev) =>
          prev.map((a) =>
            a.id === mainAsset.id ? { ...a, rotation, suggestedRotation: 0 } : a,
          ),
        );
      } finally {
        setBusy(false);
      }
    },
    [projectId, mainAsset],
  );

  /**
   * Pull the project's assets again. AI b-roll clips are inserted as
   * 'generating' rows and filled in by a detached job (~1 min each), so while
   * any are still rendering we poll until they all settle.
   */
  const refreshAssets = useCallback(async () => {
    const d = await fetch(API(projectId)).then((r) => r.json()).catch(() => null);
    if (d?.ok) {
      setAssets(d.assets.map((a: VideoAsset) => ({ ...a, createdAt: new Date(a.createdAt) })));
    }
  }, [projectId]);

  const anyGenerating = assets.some((a) => a.genStatus === "generating");
  useEffect(() => {
    if (!anyGenerating) return;
    const t = setInterval(refreshAssets, 5000);
    return () => clearInterval(t);
  }, [anyGenerating, refreshAssets]);

  const onRecaption = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await fetch(`${API(projectId)}/transcribe`, { method: "POST" });
      await pollUntilIdle();
    } finally {
      setBusy(false);
    }
  }, [projectId, pollUntilIdle]);

  const onResuggestBroll = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await fetch(`${API(projectId)}/plan`, { method: "POST" });
      await pollUntilIdle();
      // pull the new plan into the timeline (output coords)
      const d = await fetch(API(projectId)).then((r) => r.json());
      if (d?.ok && d.project.planJson) {
        try {
          const plan = JSON.parse(d.project.planJson) as {
            brollInserts: TimelineDoc["brollInserts"];
          };
          const doc = timelineSnapshotRef.current;
          // The fresh plan is in main-SOURCE coords; remap onto our edited
          // output timeline so cutaways land correctly after trims/reorders.
          applyChange({
            ...doc,
            brollInserts: remapBrollSourceToOutput(plan.brollInserts ?? [], doc.mainSegments),
          });
        } catch {}
      }
    } finally {
      setBusy(false);
    }
  }, [projectId, pollUntilIdle, applyChange]);

  /**
   * Add clips to this project — from a drag-and-drop onto the editor or the
   * tray's file picker. Until this existed a project's footage was fixed at
   * creation time, so there was no way to add b-roll after the fact.
   */
  const uploadClips = useCallback(
    async (files: File[]) => {
      const videos = files.filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|m4v)$/i.test(f.name));
      if (videos.length === 0) {
        setError("Drop a video file (MP4, MOV, WebM or MKV).");
        return;
      }
      setUploading(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.append("kind", "broll");
        for (const f of videos) fd.append("files", f);
        const d = await fetch(`${API(projectId)}/assets`, { method: "POST", body: fd }).then((r) =>
          r.json(),
        );
        if (!d.ok) {
          setError(d.error ?? "Couldn't add that clip.");
          return;
        }
        await refreshAssets();
      } catch {
        setError("Couldn't upload that clip.");
      } finally {
        setUploading(false);
      }
    },
    [projectId, refreshAssets],
  );

  const onExport = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await flushTimeline();
      await fetch(`${API(projectId)}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await pollUntilIdle();
    } finally {
      setBusy(false);
    }
  }, [projectId, flushTimeline, pollUntilIdle]);

  const rendering = ["transcribing", "planning", "rendering", "queued"].includes(project.status);
  const usedBrollIds = new Set(timeline.brollInserts.map((b) => b.brollAssetId));
  const outputUrl =
    project.status === "rendered" && project.outputFilename
      ? `${API(projectId)}/output?v=${encodeURIComponent(project.outputFilename)}`
      : null;

  return (
    <div
      style={{ display: "grid", gap: 14, position: "relative" }}
      onDragOver={(e) => {
        // Only react to actual file drags, not text/element drags inside the
        // timeline (which has its own drag interactions).
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(false);
        uploadClips(Array.from(e.dataTransfer.files));
      }}
    >
      {(dragging || uploading) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 20,
            display: "grid",
            placeItems: "center",
            gap: 10,
            borderRadius: "var(--radius)",
            border: "2px dashed var(--text-primary)",
            background: "rgba(12,13,16,0.82)",
            backdropFilter: "blur(2px)",
            pointerEvents: "none",
            textAlign: "center",
          }}
        >
          <div style={{ display: "grid", justifyItems: "center", gap: 8 }}>
            {uploading ? (
              <Loader2 size={22} className="spin" />
            ) : (
              <Plus size={22} />
            )}
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {uploading ? "Adding your clip…" : "Drop to add as b-roll"}
            </div>
            {!uploading && (
              <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                MP4, MOV, WebM or MKV
              </div>
            )}
          </div>
        </div>
      )}

      {/* top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          background: "var(--bg)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          padding: "10px 14px",
          boxShadow: "var(--shadow-1)",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>{project.name}</span>
        {rendering && (
          <span style={{ fontSize: 12, color: "#7c3aed" }}>
            {project.status === "rendering" ? "Rendering…" : project.status === "planning" ? "Planning…" : project.status === "transcribing" ? "Transcribing…" : "Working…"}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Button variant="outline" onClick={undo} disabled={undoStack.length === 0 || busy}>
            <Undo2 size={14} /> Undo
          </Button>
          <Button onClick={onExport} disabled={busy || rendering}>
            <Download size={14} /> Export MP4
          </Button>
        </div>
      </div>

      {/* Orientation prompt — only for footage that looks shot sideways (a
          landscape file with no rotation metadata, e.g. a camera turned on its
          side). The AI's guess is pre-selected but nothing is applied until the
          operator confirms, because no file data can settle it for certain. */}
      {/* Orientation. The AI can only ever SUGGEST which way is up (a sideways
          -shot file has no metadata saying so), and a suggestion can be wrong —
          so the rotate controls are always available, not just while the clip is
          unrotated. The prompt styling appears only when there's an unresolved
          suggestion. */}
      {mainAsset && (() => {
        const pending = mainAsset.suggestedRotation > 0 && mainAsset.rotation === 0;
        const turn = (delta: number) =>
          onSetMainRotation((((mainAsset.rotation + delta) % 360) + 360) % 360);
        return (
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
              padding: pending ? "12px 14px" : "8px 12px",
              borderRadius: "var(--radius)",
              background: pending ? "var(--warning-soft)" : "transparent",
              border: `1px solid ${pending ? "var(--warning)" : "var(--grid)"}`,
              fontSize: 13,
            }}
          >
            <RotateCw
              size={pending ? 16 : 14}
              style={{ color: pending ? "var(--warning)" : "var(--text-tertiary)", flexShrink: 0 }}
            />
            <span style={{ flex: 1, minWidth: 200, color: pending ? undefined : "var(--text-tertiary)" }}>
              {pending ? (
                <>
                  This looks like it was <strong>filmed sideways</strong>. Rotate it upright?
                </>
              ) : (
                `Orientation${mainAsset.rotation ? ` — rotated ${mainAsset.rotation}°` : ""}`
              )}
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {pending ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => onSetMainRotation(mainAsset.suggestedRotation)}
                    disabled={busy}
                  >
                    <RotateCw size={13} />
                    Rotate {mainAsset.suggestedRotation === 270 ? "left" : "right"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onSetMainRotation(mainAsset.suggestedRotation === 270 ? 90 : 270)}
                    disabled={busy}
                  >
                    Other way
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onSetMainRotation(0)} disabled={busy}>
                    It&rsquo;s fine
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => turn(270)} disabled={busy} title="Rotate left">
                    <RotateCcw size={13} />
                    Left
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => turn(90)} disabled={busy} title="Rotate right">
                    <RotateCw size={13} />
                    Right
                  </Button>
                  {mainAsset.rotation !== 0 && (
                    <Button size="sm" variant="ghost" onClick={() => onSetMainRotation(0)} disabled={busy}>
                      Reset
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {error && (
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "10px 12px",
            borderRadius: "var(--radius)",
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.25)",
            color: "#b91c1c",
            fontSize: 13,
          }}
        >
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {/* preview + inspector */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 320px) 1fr", gap: 14, alignItems: "start" }}>
        <PreviewStage
          ref={previewRef}
          projectId={projectId}
          timeline={timeline}
          assets={assets}
          words={transcript.words}
          aspectRatio={project.aspectRatio as AspectRatio}
          captionFont={project.captionFont}
          musicSrc={
            project.musicFilename
              ? `/api/content-studio/music/preview?file=${encodeURIComponent(project.musicFilename)}`
              : null
          }
          musicVolume={project.musicVolume}
          onPlayheadChange={setPlayhead}
        />
        <Inspector
          projectId={projectId}
          selection={selection}
          timeline={timeline}
          transcript={transcript}
          brollAssets={brollAssets}
          fields={{
            captionFont: project.captionFont,
            musicFilename: project.musicFilename,
            musicVolume: project.musicVolume,
            showIntroOutro: project.showIntroOutro,
            introDurationSec: project.introDurationSec,
          }}
          musicTracks={musicTracks}
          captionFonts={captionFonts}
          busy={busy}
          onChange={applyChange}
          onTranscriptChange={setTranscript}
          onSelect={setSelection}
          onPatchFields={onPatchFields}
          onRecaption={onRecaption}
          onResuggestBroll={onResuggestBroll}
          onExport={onExport}
        />
      </div>

      {/* timeline */}
      <div
        style={{
          background: "var(--bg)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          padding: 14,
          boxShadow: "var(--shadow-1)",
        }}
      >
        <Timeline
          timeline={timeline}
          transcript={transcript}
          brollAssets={brollAssets}
          mainSourceDuration={mainSourceDuration}
          playhead={playhead}
          selection={selection}
          onSelect={setSelection}
          onScrub={onScrub}
          onChange={applyChange}
          onSplit={onSplit}
          onDeleteSegment={onDeleteSegment}
        />

        {/* b-roll tray — click a clip to drop a cutaway at the playhead */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--hairline)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-tertiary)", letterSpacing: "0.06em" }}>
            B-roll tray
          </span>
          {brollAssets.length === 0 && (
            <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
              No b-roll clips on this project.
            </span>
          )}
          {brollAssets.map((b) => {
            const used = usedBrollIds.has(b.id);
            // AI clips exist in the tray while fal renders them (~1 min), so
            // they show their state instead of being addable.
            const generating = b.genStatus === "generating";
            const failed = b.genStatus === "failed";
            return (
              <button
                key={b.id}
                type="button"
                disabled={generating || failed}
                onClick={() => onAddBrollAtPlayhead(b.id)}
                title={
                  generating
                    ? "Generating this clip…"
                    : failed
                      ? b.genError ?? "Generation failed"
                      : used
                        ? `${b.originalName} (already placed — adds another)`
                        : `Add ${b.originalName} at the playhead`
                }
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  background: failed ? "var(--danger-soft)" : "#241c12",
                  border: `1px solid ${failed ? "var(--danger)" : "#6b5226"}`,
                  borderRadius: 4,
                  padding: "4px 8px",
                  fontSize: 10,
                  color: failed ? "var(--danger)" : "#e3c590",
                  maxWidth: 160,
                  cursor: generating || failed ? "default" : "pointer",
                  opacity: generating ? 0.7 : used ? 0.55 : 1,
                }}
              >
                {generating ? (
                  <Loader2 size={11} className="spin" />
                ) : failed ? (
                  <AlertTriangle size={11} />
                ) : (
                  <Plus size={11} />
                )}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {generating ? "Generating…" : failed ? "Failed" : b.originalName}
                </span>
              </button>
            );
          })}
          {/* Click-to-browse alongside drag-and-drop — dragging isn't
              discoverable, and isn't available to every user. */}
          <button
            type="button"
            onClick={() => clipInputRef.current?.click()}
            disabled={uploading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              background: "var(--surface-2)",
              border: "1px dashed var(--hairline-strong)",
              borderRadius: 4,
              padding: "4px 9px",
              fontSize: 10,
              color: "var(--text-secondary)",
              cursor: uploading ? "default" : "pointer",
            }}
          >
            <Plus size={11} />
            {uploading ? "Adding…" : "Add clips"}
          </button>
          <input
            ref={clipInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-m4v"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              if (list.length > 0) uploadClips(list);
              e.target.value = "";
            }}
          />
          <GenerateBrollDialog projectId={projectId} onQueued={refreshAssets} />
        </div>
      </div>

      {/* output */}
      {outputUrl && (
        <div
          style={{
            background: "var(--bg)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius)",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            boxShadow: "var(--shadow-1)",
          }}
        >
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>
            Latest export
          </div>
          <video
            key={project.outputFilename ?? ""}
            controls
            playsInline
            src={outputUrl}
            style={{ maxWidth: project.aspectRatio === "9:16" ? 280 : 360, width: "100%", borderRadius: 8, background: "#000" }}
          />
          <a href={`${outputUrl}&download=1`} download>
            <Button variant="outline">
              <Download size={14} /> Download MP4
            </Button>
          </a>
        </div>
      )}
    </div>
  );
}
