"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2, Plus, AlertTriangle, ArrowUp } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import {
  updateInboxAiSettings,
  promoteTagAction,
  deleteTagAction,
  addCoreTagAction,
} from "@/app/settings/inbox-ai/actions";
import type { InboxAiSettings } from "@/lib/inbox/settings";
import type { Tag } from "@/lib/db/schema";

const AUTO_CATEGORIES = [
  { value: "faq" as const, label: "General enquiry / FAQ" },
  { value: "new_lead" as const, label: "New lead" },
];

export function InboxAiSettingsForm({
  initial,
  tags,
  briefComplete,
}: {
  initial: InboxAiSettings;
  tags: Tag[];
  briefComplete: boolean;
}) {
  const [s, setS] = useState<InboxAiSettings>(initial);
  const [saving, startSave] = useTransition();
  const [tagBusy, startTag] = useTransition();
  const [newTag, setNewTag] = useState("");
  const router = useRouter();

  function toggleCategory(c: "faq" | "new_lead") {
    setS((prev) => {
      const has = prev.autoReplyCategories.includes(c);
      return {
        ...prev,
        autoReplyCategories: has
          ? prev.autoReplyCategories.filter((x) => x !== c)
          : [...prev.autoReplyCategories, c],
      };
    });
  }

  function save() {
    startSave(async () => {
      const res = await updateInboxAiSettings(s);
      if (res.ok) {
        toast.success("Inbox AI settings saved.");
        router.refresh();
      }
    });
  }

  function promote(id: number) {
    startTag(async () => {
      await promoteTagAction(id);
      toast.success("Tag promoted to core.");
      router.refresh();
    });
  }
  function remove(id: number) {
    startTag(async () => {
      await deleteTagAction(id);
      toast.success("Tag deleted.");
      router.refresh();
    });
  }
  function addTag() {
    const l = newTag.trim();
    if (!l) return;
    startTag(async () => {
      await addCoreTagAction(l);
      setNewTag("");
      toast.success("Tag added.");
      router.refresh();
    });
  }

  const core = tags.filter((t) => t.isCore);
  const suggested = tags.filter((t) => !t.isCore);
  const pct = Math.round(s.autoReplyConfidenceThreshold * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <CardLabel>Auto-reply</CardLabel>

        {!briefComplete && (
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              padding: 12,
              marginBottom: 16,
              border: "1px solid var(--accent)",
              borderRadius: "var(--radius)",
              background: "var(--accent-soft)",
            }}
          >
            <AlertTriangle size={16} color="var(--accent)" />
            <div style={{ fontSize: 13, color: "var(--text-primary)" }}>
              Auto-reply won&rsquo;t send until your{" "}
              <Link
                href="/settings/business"
                style={{ color: "var(--accent)", textDecoration: "underline" }}
              >
                Business Brief
              </Link>{" "}
              is filled — the AI needs it to answer accurately.
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>
              Enable auto-reply
            </div>
            <div
              style={{
                color: "var(--text-secondary)",
                fontSize: 13,
                marginTop: 2,
              }}
            >
              When on, the AI sends replies for the categories below — only when
              confident and never for sensitive messages. Off = it drafts every
              reply for your approval.
            </div>
          </div>
          <button
            type="button"
            aria-pressed={s.autoReplyEnabled}
            onClick={() =>
              setS((p) => ({ ...p, autoReplyEnabled: !p.autoReplyEnabled }))
            }
            style={{
              flexShrink: 0,
              width: 46,
              height: 26,
              borderRadius: 13,
              border: "1px solid var(--hairline)",
              background: s.autoReplyEnabled
                ? "var(--accent)"
                : "var(--surface-2)",
              position: "relative",
              cursor: "pointer",
              transition: "background 0.15s var(--ease)",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 2,
                left: s.autoReplyEnabled ? 22 : 2,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "#fff",
                transition: "left 0.15s var(--ease)",
              }}
            />
          </button>
        </div>

        <div style={{ marginTop: 20 }}>
          <Label>Categories the AI may auto-send</Label>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginTop: 6,
            }}
          >
            {AUTO_CATEGORIES.map((c) => (
              <label
                key={c.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 14,
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={s.autoReplyCategories.includes(c.value)}
                  onChange={() => toggleCategory(c.value)}
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <Label>
            Confidence threshold — {pct}% (lower than this drafts instead of
            sending)
          </Label>
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.05}
            value={s.autoReplyConfidenceThreshold}
            onChange={(e) =>
              setS((p) => ({
                ...p,
                autoReplyConfidenceThreshold: Number(e.target.value),
              }))
            }
            style={{ width: "100%", marginTop: 8, accentColor: "var(--accent)" }}
          />
        </div>

        <div style={{ marginTop: 20 }}>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </Card>

      <Card>
        <CardLabel>Tags</CardLabel>
        <div
          style={{
            color: "var(--text-secondary)",
            fontSize: 13,
            marginBottom: 14,
          }}
        >
          The AI applies these to conversations. Core tags are your controlled
          vocabulary; the AI can also suggest new ones for you to promote or
          remove.
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <Input
            value={newTag}
            placeholder="Add a core tag…"
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
          />
          <Button variant="outline" onClick={addTag} disabled={tagBusy}>
            <Plus size={15} /> Add
          </Button>
        </div>

        <TagGroup
          heading={`Core (${core.length})`}
          tags={core}
          busy={tagBusy}
          onDelete={remove}
        />
        {suggested.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <TagGroup
              heading={`AI-suggested (${suggested.length})`}
              tags={suggested}
              busy={tagBusy}
              onPromote={promote}
              onDelete={remove}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

function TagGroup({
  heading,
  tags,
  busy,
  onPromote,
  onDelete,
}: {
  heading: string;
  tags: Tag[];
  busy: boolean;
  onPromote?: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-mono), monospace",
          fontSize: 11,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
          marginBottom: 8,
        }}
      >
        {heading}
      </div>
      {tags.length === 0 ? (
        <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>None.</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {tags.map((t) => (
            <span
              key={t.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 8px",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius)",
                background: "var(--surface-1)",
              }}
            >
              <Badge colour={t.color ?? undefined}>{t.label}</Badge>
              {onPromote && (
                <button
                  type="button"
                  title="Promote to core"
                  disabled={busy}
                  onClick={() => onPromote(t.id)}
                  style={{
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    color: "var(--text-secondary)",
                    display: "inline-flex",
                  }}
                >
                  <ArrowUp size={14} />
                </button>
              )}
              <button
                type="button"
                title="Delete tag"
                disabled={busy}
                onClick={() => onDelete(t.id)}
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: "var(--text-tertiary)",
                  display: "inline-flex",
                }}
              >
                <Trash2 size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
