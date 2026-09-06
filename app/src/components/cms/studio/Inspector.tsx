"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Image as ImageIcon, Link2, Type } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { SelectionPayload } from "@/components/cms/StudioCanvas";

const LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
};

/**
 * The right-hand panel: what the selected element is, where it sits, and the
 * few things it can change. Always mounted (empty state included) so selecting
 * something never resizes the canvas.
 */
export function Inspector({
  selection,
  onSetProp,
  onSelectAncestor,
  onReplaceImage,
}: {
  selection: SelectionPayload | null;
  onSetProp: (prop: "href" | "target" | "alt" | "hidden", value: string | boolean) => void;
  onSelectAncestor: (depth: number) => void;
  onReplaceImage: () => void;
}) {
  // Local mirrors so typing feels immediate; re-synced whenever the selection
  // changes underneath (a different element, or the canvas echoing a change).
  const [href, setHref] = useState("");
  const [alt, setAlt] = useState("");
  useEffect(() => {
    setHref(selection?.props.href ?? "");
    setAlt(selection?.props.alt ?? "");
  }, [selection]);

  if (!selection || !selection.kind) {
    return (
      <div style={{ padding: 16, display: "grid", gap: 8, alignContent: "start" }}>
        <div style={LABEL}>Inspector</div>
        <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.6, margin: 0 }}>
          Click anything on the page to edit it. Text edits in place; images,
          links and sections get their own controls here.
        </p>
      </div>
    );
  }

  const { kind, label, breadcrumb, props } = selection;

  return (
    <div style={{ padding: 16, display: "grid", gap: 14, alignContent: "start", minWidth: 0 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={LABEL}>Selected</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {kind === "image" ? <ImageIcon size={14} /> : kind === "link" ? <Link2 size={14} /> : <Type size={14} />}
          <span style={{ fontSize: 14, color: "var(--text-primary)" }}>{label}</span>
          <code style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{props.tag}</code>
        </div>
      </div>

      {breadcrumb.length > 1 && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={LABEL}>Inside</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
            {breadcrumb.map((b, i) => (
              <span key={`${b.label}-${b.depth}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {i > 0 && <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>/</span>}
                <button
                  onClick={() => onSelectAncestor(b.depth)}
                  style={{
                    border: "none",
                    background: b.depth === 0 ? "var(--surface-2)" : "transparent",
                    color: b.depth === 0 ? "var(--text-primary)" : "var(--text-secondary)",
                    borderRadius: 5,
                    padding: "3px 6px",
                    fontSize: 11.5,
                    cursor: "pointer",
                  }}
                >
                  {b.label}
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {kind === "text" && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={LABEL}>Text</div>
          <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: 0, lineHeight: 1.55 }}>
            Edit it straight on the page. Select words for bold, italic or a link.
          </p>
          {props.words != null && (
            <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{props.words} words</div>
          )}
        </div>
      )}

      {kind === "link" && (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={LABEL}>Link</div>
          <Input
            value={href}
            placeholder="/sign-up or https://…"
            onChange={(e) => setHref(e.target.value)}
            onBlur={() => onSetProp("href", href)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-secondary)" }}>
            <input
              type="checkbox"
              checked={!!props.newTab}
              onChange={(e) => onSetProp("target", e.target.checked)}
            />
            Opens in a new tab
          </label>
        </div>
      )}

      {kind === "image" && (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={LABEL}>Image</div>
          {props.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={props.src}
              alt={props.alt || ""}
              style={{
                width: "100%",
                aspectRatio: "16/10",
                objectFit: "cover",
                borderRadius: 8,
                border: "1px solid var(--hairline)",
                display: "block",
              }}
            />
          ) : null}
          <Button size="sm" variant="outline" onClick={onReplaceImage}>
            <ImageIcon size={14} /> Replace image
          </Button>
          <div style={{ display: "grid", gap: 5 }}>
            <div style={LABEL}>Alt text</div>
            <Input
              value={alt}
              placeholder="Describe the image"
              onChange={(e) => setAlt(e.target.value)}
              onBlur={() => onSetProp("alt", alt)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
        </div>
      )}

      {kind === "section" && (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={LABEL}>Section</div>
          <Button size="sm" variant="outline" onClick={() => onSetProp("hidden", !props.hidden)}>
            {props.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
            {props.hidden ? "Show this section" : "Hide this section"}
          </Button>
          <p style={{ fontSize: 11.5, color: "var(--text-tertiary)", margin: 0, lineHeight: 1.55 }}>
            {props.hidden
              ? "Hidden on the live page. It stays here, faded, so you can switch it back on."
              : "Hiding keeps the section in the page but stops it rendering for visitors."}
          </p>
        </div>
      )}
    </div>
  );
}
