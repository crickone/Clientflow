"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Undo2, Download, AlertTriangle, Plus } from "lucide-react";

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
    <div style={{ display: "grid", gap: 14 }}>
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
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onAddBrollAtPlayhead(b.id)}
                title={used ? `${b.originalName} (already placed — adds another)` : `Add ${b.originalName} at the playhead`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  background: "#241c12",
                  border: "1px solid #6b5226",
                  borderRadius: 4,
                  padding: "4px 8px",
                  fontSize: 10,
                  color: "#e3c590",
                  maxWidth: 160,
                  cursor: "pointer",
                  opacity: used ? 0.55 : 1,
                }}
              >
                <Plus size={11} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {b.originalName}
                </span>
              </button>
            );
          })}
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
