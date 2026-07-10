"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Download, Trash2, Type, Music, Film } from "lucide-react";

import { Button } from "@/components/ui/Button";
import type { VideoAsset } from "@/lib/db/schema";
import type { Transcript } from "@/lib/ai/transcribe";
import type { TimelineDoc } from "@/lib/video/timeline";
import { deleteSegment, removeBroll, reorderSegment, updateBroll } from "@/lib/video/timeline";
import { applySegmentTextEdit } from "@/lib/video/transcriptEdit";
import type { Selection } from "./types";

interface ProjectFields {
  captionFont: string;
  musicFilename: string | null;
  musicVolume: number;
  showIntroOutro: boolean;
  introDurationSec: number;
}

interface Props {
  projectId: number;
  selection: Selection;
  timeline: TimelineDoc;
  transcript: Transcript;
  brollAssets: VideoAsset[];
  fields: ProjectFields;
  musicTracks: Array<{ filename: string; label: string }>;
  captionFonts: Array<{ name: string; label: string }>;
  busy: boolean;
  onChange: (next: TimelineDoc) => void;
  onTranscriptChange: (next: Transcript) => void;
  onSelect: (sel: Selection) => void;
  onPatchFields: (patch: Record<string, unknown>) => void;
  onRecaption: () => void;
  onResuggestBroll: () => void;
  onExport: () => void;
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontWeight: 500,
  marginBottom: 4,
};
const fieldStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  padding: "8px 10px",
  color: "var(--text-primary)",
  fontSize: 13,
  fontFamily: "inherit",
};

export function Inspector(props: Props) {
  const { selection } = props;
  return (
    <div
      style={{
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: 16,
        minHeight: 320,
        boxShadow: "var(--shadow-1)",
      }}
    >
      {selection?.kind === "segment" ? (
        <SegmentPanel {...props} index={selection.index} />
      ) : selection?.kind === "broll" ? (
        <BrollPanel {...props} index={selection.index} />
      ) : selection?.kind === "caption" ? (
        <CaptionPanel {...props} segmentId={selection.segmentId} />
      ) : (
        <DefaultPanel {...props} />
      )}
    </div>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
      {children}
    </div>
  );
}
function PanelHint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 12 }}>
      {children}
    </div>
  );
}

function SegmentPanel({
  timeline,
  index,
  onChange,
  onSelect,
}: Props & { index: number }) {
  const seg = timeline.mainSegments[index];
  if (!seg) return null;
  const len = seg.sourceEnd - seg.sourceStart;
  const canDelete = timeline.mainSegments.length > 1;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <PanelTitle>Main clip · segment {index + 1}</PanelTitle>
        <PanelHint>
          Drag its edges on the timeline to trim, drag the block to reorder, or
          use Split (under the playhead).
        </PanelHint>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        Source range: {seg.sourceStart.toFixed(1)}s → {seg.sourceEnd.toFixed(1)}s
        <br />
        Length: {len.toFixed(1)}s
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button
          variant="outline"
          onClick={() => onChange(reorderSegment(timeline, index, index - 1))}
          disabled={index === 0}
        >
          ← Move earlier
        </Button>
        <Button
          variant="outline"
          onClick={() => onChange(reorderSegment(timeline, index, index + 1))}
          disabled={index === timeline.mainSegments.length - 1}
        >
          Move later →
        </Button>
      </div>
      {canDelete && (
        <button
          type="button"
          onClick={() => {
            onChange(deleteSegment(timeline, index));
            onSelect(null);
          }}
          style={{ ...fieldStyle, color: "#dc2626", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
        >
          <Trash2 size={13} /> Delete this clip
        </button>
      )}
    </div>
  );
}

function BrollPanel({
  projectId,
  timeline,
  index,
  brollAssets,
  onChange,
  onSelect,
}: Props & { index: number }) {
  const insert = timeline.brollInserts[index];
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const asset = insert ? brollAssets.find((a) => a.id === insert.brollAssetId) : null;
  const brollStart = insert?.brollStartSec ?? 0;
  const len = insert ? insert.endSec - insert.startSec : 0;
  const srcDur = asset?.durationSeconds ?? 0;
  const maxStart = Math.max(0, srcDur - len);

  useEffect(() => {
    const v = videoRef.current;
    if (v && Math.abs(v.currentTime - brollStart) > 0.05) {
      try {
        v.currentTime = brollStart;
      } catch {}
    }
  }, [brollStart, asset?.id]);

  if (!insert) return null;
  const sourceUrl = asset
    ? `/api/content-studio/projects/${projectId}/assets/${asset.id}/file`
    : null;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <PanelTitle>
          B-roll · {insert.startSec.toFixed(1)}s → {insert.endSec.toFixed(1)}s
        </PanelTitle>
        <PanelHint>Drag the block on the timeline to move or trim it.</PanelHint>
      </div>
      <div>
        <div style={labelStyle}>Clip</div>
        <select
          value={insert.brollAssetId}
          onChange={(e) => onChange(updateBroll(timeline, index, { brollAssetId: Number(e.target.value), brollStartSec: 0 }))}
          style={fieldStyle}
        >
          {brollAssets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.originalName}
            </option>
          ))}
        </select>
      </div>
      {sourceUrl && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={labelStyle}>Trim source — start at {brollStart.toFixed(1)}s</div>
          <video
            ref={videoRef}
            src={sourceUrl}
            muted
            playsInline
            preload="metadata"
            style={{ width: "100%", borderRadius: 6, background: "#000", aspectRatio: "9 / 16", objectFit: "contain", maxHeight: 200 }}
          />
          <input
            type="range"
            min={0}
            max={Math.max(0.1, maxStart)}
            step={0.1}
            value={Math.min(brollStart, maxStart)}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange(updateBroll(timeline, index, { brollStartSec: v }));
              if (videoRef.current) {
                try {
                  videoRef.current.currentTime = v;
                } catch {}
              }
            }}
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          onChange(removeBroll(timeline, index));
          onSelect(null);
        }}
        style={{ ...fieldStyle, color: "#dc2626", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
      >
        <Trash2 size={13} /> Remove cutaway
      </button>
    </div>
  );
}

function CaptionPanel({
  transcript,
  segmentId,
  onTranscriptChange,
}: Props & { segmentId: number }) {
  const seg = transcript.segments.find((s) => s.id === segmentId);
  const [text, setText] = useState(seg?.text.trim() ?? "");
  useEffect(() => setText(seg?.text.trim() ?? ""), [segmentId, seg?.text]);
  if (!seg) return null;
  const changed = text.trim() !== seg.text.trim();
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <PanelTitle>Caption · {seg.start.toFixed(1)}s</PanelTitle>
        <PanelHint>Fix a typo — word timings stay aligned when the word count is unchanged.</PanelHint>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ ...fieldStyle, minHeight: 90, resize: "vertical" }}
      />
      <Button
        onClick={() => onTranscriptChange(applySegmentTextEdit(transcript, segmentId, text))}
        disabled={!changed}
      >
        Save caption
      </Button>
    </div>
  );
}

function DefaultPanel({
  fields,
  musicTracks,
  captionFonts,
  busy,
  onPatchFields,
  onRecaption,
  onResuggestBroll,
  onExport,
}: Props) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <PanelTitle>Nothing selected</PanelTitle>
        <PanelHint>Click a clip, b-roll or caption on the timeline to edit it. Or use the actions below.</PanelHint>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={labelStyle}>AI</div>
        <Button variant="outline" onClick={onRecaption} disabled={busy}>
          <Sparkles size={14} /> Re-caption
        </Button>
        <Button variant="outline" onClick={onResuggestBroll} disabled={busy}>
          <Sparkles size={14} /> Re-suggest b-roll
        </Button>
      </div>

      <div>
        <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
          <Type size={12} /> Caption font
        </div>
        <select
          value={fields.captionFont}
          onChange={(e) => onPatchFields({ captionFont: e.target.value })}
          style={fieldStyle}
        >
          {captionFonts.map((f) => (
            <option key={f.name} value={f.name}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
          <Music size={12} /> Background music
        </div>
        <select
          value={fields.musicFilename ?? ""}
          onChange={(e) => onPatchFields({ musicFilename: e.target.value || null })}
          style={fieldStyle}
        >
          <option value="">No music</option>
          {musicTracks.map((t) => (
            <option key={t.filename} value={t.filename}>
              {t.label}
            </option>
          ))}
        </select>
        {fields.musicFilename && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Vol</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              defaultValue={fields.musicVolume}
              onPointerUp={(e) => onPatchFields({ musicVolume: Number((e.target as HTMLInputElement).value) })}
              style={{ flex: 1 }}
            />
          </div>
        )}
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={fields.showIntroOutro}
          onChange={(e) => onPatchFields({ showIntroOutro: e.target.checked })}
        />
        <Film size={13} /> Logo intro
      </label>

      <Button onClick={onExport} disabled={busy}>
        <Download size={14} /> Export MP4
      </Button>
    </div>
  );
}

