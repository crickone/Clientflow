"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { saveCapEur } from "@/app/agents/actions";

/**
 * Batch 3bc (C4): the one ADMIN control for the per-tenant monthly AI spend
 * cap. Every agent page's usage copy has long promised "raise the cap in
 * Settings" (see AiCapError, @/lib/ai/usage) with nothing actually behind
 * it — this is that control. Lives on the Agents overview, next to the
 * usage meter it governs, rather than a separate Settings page: that's where
 * an admin already is when they hit the cap. Explicit Save (no auto-save),
 * matching every other editable field in this app (AgentContextEditor,
 * ModelCard) — per user preference, edits only take effect on a click.
 *
 * Renders inline in AgentOrgChart's usage card; the whole /agents page is
 * already admin-gated (requireAdminPage), so this needs no isAdmin prop of
 * its own — reached at all only means the viewer is one.
 */
export function CapEditor({ capCents }: { capCents: number }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(capCents / 100));
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(String(capCents / 100));
          setEditing(true);
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          marginTop: 4,
          padding: 0,
          border: "none",
          background: "none",
          color: "var(--text-tertiary)",
          fontSize: 11.5,
          textTransform: "none",
          cursor: "pointer",
        }}
      >
        <Pencil size={11} strokeWidth={1.75} /> Edit cap
      </button>
    );
  }

  function save() {
    const eur = Number(value);
    if (!Number.isFinite(eur) || eur < 1 || eur > 1000) {
      toast.error("Cap must be between €1 and €1000.");
      return;
    }
    startTransition(async () => {
      try {
        await saveCapEur(eur);
        toast.success("Monthly AI cap updated.");
        setEditing(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not update the cap.");
      }
    });
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 4, textTransform: "none" }}>
      <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>€</span>
      <Input
        type="number"
        min={1}
        max={1000}
        step={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={pending}
        style={{ width: 72, padding: "6px 8px", fontSize: 12.5 }}
      />
      <Button size="sm" onClick={save} disabled={pending} loading={pending}>
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
        Cancel
      </Button>
    </span>
  );
}
