"use client";

import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";

export interface StageColumnProps {
  stageId: number;
  stage: { name: string; colour: string };
  count: number; // cards shown in this column
  total?: number; // all-time count (shown when it differs from `count`, e.g. won-stage 30d window)
  rail?: boolean; // lapsed / lost render as a slim collapsible rail
  expanded?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}

/**
 * One droppable pipeline column. Funnel stages are full columns; `lapsed`/`lost`
 * pass `rail` and collapse to a slim vertical bar that is STILL a drop target
 * (auto-expands on drag-over via the isOver highlight). Droppable id is the
 * stage's numeric id (stringified) — the DB record backing the column.
 */
export function StageColumn({ stageId, stage, count, total, rail = false, expanded = true, onToggle, children }: StageColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: String(stageId) });
  const collapsed = rail && !expanded && !isOver;

  if (collapsed) {
    return (
      <button
        ref={setNodeRef}
        onClick={onToggle}
        title={`${stage.name} (${count})`}
        style={{
          width: 46,
          flex: "0 0 auto",
          alignSelf: "stretch",
          border: "1px solid var(--hairline)",
          background: "var(--surface-1)",
          borderRadius: "var(--radius)",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          padding: "12px 0",
          color: "var(--text-secondary)",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: stage.colour }} />
        <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 12, letterSpacing: "0.04em" }}>
          {stage.name}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{count}</span>
      </button>
    );
  }

  return (
    <div
      style={{
        minWidth: 280,
        width: 280,
        flex: "0 0 auto",
        scrollSnapAlign: "start",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: stage.colour }} />
        <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>{stage.name}</strong>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-tertiary)" }}>
          {total != null && total !== count ? `${count} / ${total}` : count}
        </span>
        {rail && onToggle && (
          <button
            type="button"
            onClick={onToggle}
            title="Collapse"
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-tertiary)", display: "inline-flex" }}
          >
            <ChevronLeft size={14} />
          </button>
        )}
      </div>
      <div
        ref={setNodeRef}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: 8,
          minHeight: 120,
          flex: 1,
          borderRadius: "var(--radius)",
          background: isOver ? `${stage.colour}14` : "var(--surface-1)",
          border: `1px solid ${isOver ? `${stage.colour}66` : "var(--hairline)"}`,
          transition: "background .15s var(--ease), border-color .15s var(--ease)",
        }}
      >
        {count === 0 ? (
          <div style={{ padding: "20px 8px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 12, border: "1px dashed var(--hairline)", borderRadius: "var(--radius)" }}>
            No leads here
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
