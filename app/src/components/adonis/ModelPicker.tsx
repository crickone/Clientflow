"use client";

import { type CSSProperties, useState, useTransition } from "react";
import { Check, ChevronDown, Cpu, Lock } from "lucide-react";
import { toast } from "sonner";

import { saveModel } from "@/app/agents/actions";
import { MODEL_CATALOG, modelLabel, type ModelChoice } from "@/lib/ai/modelCatalog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";

/**
 * The model chip under the /adonis compose box: names the model Adonis is
 * running on, and lets an admin switch it in place. It writes the same
 * `agents.model` row as the Model card on /agents/orchestrator (via the same
 * admin-gated `saveModel` server action), so the two never disagree, and the
 * chat route picks the new model up on the very next turn.
 *
 * Staff see the label only: switching is an admin decision (it moves spend),
 * and `saveModel` would reject a non-admin anyway.
 */
export function ModelPicker({
  agentKey,
  initialModel,
  canEdit,
  openRouterConfigured,
}: {
  agentKey: string;
  initialModel: string;
  canEdit: boolean;
  openRouterConfigured: boolean;
}) {
  const [model, setModel] = useState(initialModel);
  const [pending, startTransition] = useTransition();

  function pick(choice: ModelChoice) {
    if (pending || choice.id === model) return;
    if (choice.needsOpenRouter && !openRouterConfigured) return;
    const prev = model;
    setModel(choice.id); // optimistic
    startTransition(async () => {
      try {
        await saveModel(agentKey, choice.id);
        toast.success(`Adonis now runs on ${choice.label}.`);
      } catch (err) {
        setModel(prev);
        toast.error(err instanceof Error ? err.message : "Could not switch model.");
      }
    });
  }

  const chipStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    border: "1px solid var(--hairline)",
    borderRadius: 999,
    background: "transparent",
    color: "var(--text-tertiary)",
    fontSize: 11.5,
    lineHeight: 1.3,
    fontFamily: "inherit",
  };

  const label = modelLabel(model);

  if (!canEdit) {
    return (
      <span style={chipStyle} title="The AI model Adonis is using">
        <Cpu size={12} strokeWidth={1.75} />
        {label}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Model: ${label}. Change model`}
          disabled={pending}
          style={{ ...chipStyle, cursor: pending ? "wait" : "pointer" }}
        >
          <Cpu size={12} strokeWidth={1.75} />
          {label}
          <ChevronDown size={12} strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" style={{ minWidth: 280 }}>
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        {MODEL_CATALOG.map((choice) => {
          const selected = choice.id === model;
          const locked = Boolean(choice.needsOpenRouter) && !openRouterConfigured;
          return (
            <DropdownMenuItem
              key={choice.id}
              disabled={locked}
              onSelect={() => pick(choice)}
              style={{ alignItems: "flex-start", opacity: locked ? 0.5 : 1 }}
            >
              <span style={{ width: 14, flexShrink: 0, paddingTop: 2 }}>
                {selected ? (
                  <Check size={14} strokeWidth={2} style={{ color: "var(--accent)" }} />
                ) : locked ? (
                  <Lock size={12} strokeWidth={1.75} />
                ) : null}
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ color: selected ? "var(--text-primary)" : undefined, fontWeight: selected ? 600 : 500 }}>
                  {choice.label}
                </span>
                <span style={{ fontSize: 11.5, color: "var(--text-tertiary)", lineHeight: 1.35 }}>
                  {locked ? "Needs setup" : choice.note}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
