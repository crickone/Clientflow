"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { saveInstructions } from "@/app/agents/actions";

const MAX_LEN = 8000; // mirrors updateAgentInstructions' own truncation in @/lib/agents/registry

/**
 * The one EDITABLE layer of an agent's system prompt (operator instructions).
 * Per user preference this uses an explicit, visible Save action rather than
 * auto-save: edits only take effect once the operator clicks Save, and the
 * button stays disabled until there's something new to save.
 */
export function AgentContextEditor({ agentKey, initial }: { agentKey: string; initial: string }) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const dirty = text !== saved;

  function save() {
    if (!dirty || pending) return;
    startTransition(async () => {
      try {
        await saveInstructions(agentKey, text);
        setSaved(text);
        toast.success("Instructions saved.");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not save instructions.");
      }
    });
  }

  return (
    <div>
      <Textarea
        rows={10}
        value={text}
        maxLength={MAX_LEN}
        onChange={(e) => setText(e.target.value)}
        placeholder="Extra instructions for this agent — tone, priorities, things to always or never do. Layered on top of its base playbook and business context, and always subject to the safety rails below."
        disabled={pending}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
        <span style={{ fontSize: 11.5, color: "var(--text-tertiary)", fontFamily: "var(--font-mono), ui-monospace, monospace" }}>
          {text.length} / {MAX_LEN}
        </span>
        <span
          style={{
            fontSize: 12,
            color: pending ? "var(--text-tertiary)" : dirty ? "var(--accent)" : "var(--text-tertiary)",
          }}
        >
          {pending ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}
        </span>
        <Button size="sm" onClick={save} disabled={!dirty || pending} style={{ marginLeft: "auto" }}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
