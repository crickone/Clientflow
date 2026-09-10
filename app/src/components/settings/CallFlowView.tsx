"use client";

import { useState } from "react";
import { CheckCircle2, Clock, PhoneCall, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { SaveStatus } from "./SaveStatus";
import { useAutosave } from "./useAutosave";
import { saveCallFlowAction } from "@/app/settings/voice/flow/actions";
import type { CallFlowConfig, FlowStep } from "@/lib/voice/flow";

/**
 * The call flow, drawn.
 *
 * The spine is fixed and the settings are editable — the steps come from
 * `describeFlow` on the server, generated from the same config the dialler
 * enforces, so what an operator reads here is what actually happens. A
 * drag-and-drop canvas could draw a flow the engine doesn't implement; this
 * can't, which is the whole reason it isn't one.
 */

const STEP_ICON = {
  trigger: Sparkles,
  wait: Clock,
  checks: ShieldCheck,
  call: PhoneCall,
  branch: CheckCircle2,
} as const;

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

export function CallFlowView({
  flow: initialFlow,
  steps: initialSteps,
  stageOptions,
  pending,
}: {
  flow: CallFlowConfig;
  steps: FlowStep[];
  stageOptions: { role: string; name: string }[];
  pending: { leadName: string; dueAt: number; attempt: number }[];
}) {
  const [flow, setFlow] = useState(initialFlow);
  const [steps, setSteps] = useState(initialSteps);
  const [openStep, setOpenStep] = useState<string | null>(null);

  const autosave = useAutosave({
    values: flow,
    save: async (v) => {
      const res = await saveCallFlowAction(v);
      if (!res.ok) throw new Error(res.error);
      // The step sentences are generated from the config server-side; re-render
      // them locally from the saved value so the diagram never shows a
      // description of settings that didn't save.
      setFlow(res.flow);
    },
  });

  function patch(p: Partial<CallFlowConfig>) {
    setFlow((f) => ({ ...f, ...p }));
    setSteps((s) => localDescribe({ ...flow, ...p }, s));
  }

  function toggleArmed() {
    const next = !flow.enabled;
    patch({ enabled: next });
    toast.success(
      next
        ? "Automatic calling is on. New leads will be called under the rules below."
        : "Automatic calling is off. Nothing will be called automatically.",
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* The arm switch, deliberately the first and loudest thing on the page. */}
      <Card style={{ padding: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            Automatic calling is {flow.enabled ? "on" : "off"}
          </div>
          <p style={{ fontSize: 13.5, color: "var(--text-secondary)", margin: "4px 0 0", lineHeight: 1.5, maxWidth: 560 }}>
            {flow.enabled
              ? "New leads are called automatically under the rules below. You can turn this off at any time and calls already queued will stop."
              : "Nothing is called automatically. You can still call any lead by hand from their page — that always works, and ignores the calling hours below."}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleArmed}
          className={flow.enabled ? "btn btn--outline btn--md" : "btn btn--primary btn--md"}
        >
          {flow.enabled ? "Turn off" : "Turn on automatic calling"}
        </button>
      </Card>

      {/* The flow */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {steps.map((step, i) => {
          const Icon = STEP_ICON[step.kind];
          const isOpen = openStep === step.kind;
          const editable = step.fields.length > 0 || step.kind === "branch";
          return (
            <div key={step.kind}>
              <Card
                style={{
                  padding: 16,
                  opacity: flow.enabled || step.kind === "trigger" ? 1 : 0.6,
                  cursor: editable ? "pointer" : "default",
                }}
                onClick={editable ? () => setOpenStep(isOpen ? null : step.kind) : undefined}
              >
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span
                    aria-hidden
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: "var(--surface-2)",
                      border: "1px solid var(--hairline)",
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={16} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14.5, fontWeight: 600 }}>{step.title}</span>
                      {editable && (
                        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                          {isOpen ? "click to close" : "click to edit"}
                        </span>
                      )}
                    </div>
                    {step.detail && (
                      <p style={{ fontSize: 13.5, color: "var(--text-secondary)", margin: "4px 0 0", lineHeight: 1.5 }}>
                        {step.detail}
                      </p>
                    )}
                    {step.branches && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                        {step.branches.map((b) => (
                          <div
                            key={b.label}
                            style={{
                              borderLeft: "2px solid var(--hairline)",
                              paddingLeft: 12,
                            }}
                          >
                            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{b.label}</div>
                            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>{b.detail}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div
                    style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--hairline)" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <StepEditor step={step} flow={flow} patch={patch} stageOptions={stageOptions} />
                  </div>
                )}
              </Card>
              {i < steps.length - 1 && (
                <div aria-hidden style={{ height: 18, display: "grid", placeItems: "center" }}>
                  <div style={{ width: 1, height: "100%", background: "var(--hairline)" }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* What the flow is about to do — the honest answer to "who is this thing going to ring?" */}
      <Card style={{ padding: 20 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Up next</div>
        {pending.length === 0 ? (
          <p style={{ fontSize: 13.5, color: "var(--text-secondary)", margin: "6px 0 0" }}>
            Nothing queued. {flow.enabled ? "New leads will appear here once they arrive." : "Automatic calling is off."}
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-tertiary)" }}>
                <th style={{ padding: "6px 8px", fontWeight: 500 }}>Lead</th>
                <th style={{ padding: "6px 8px", fontWeight: 500 }}>Due</th>
                <th style={{ padding: "6px 8px", fontWeight: 500 }}>Attempt</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((p, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--hairline)" }}>
                  <td style={{ padding: 8 }}>{p.leadName}</td>
                  <td style={{ padding: 8 }}>{new Date(p.dueAt).toLocaleString("en-IE")}</td>
                  <td style={{ padding: 8 }}>
                    {p.attempt + 1} of {flow.maxAttempts}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <SaveStatus autosave={autosave} />
    </div>
  );
}

function StepEditor({
  step,
  flow,
  patch,
  stageOptions,
}: {
  step: FlowStep;
  flow: CallFlowConfig;
  patch: (p: Partial<CallFlowConfig>) => void;
  stageOptions: { role: string; name: string }[];
}) {
  if (step.kind === "trigger") {
    return (
      <p style={{ fontSize: 13.5, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
        Use the switch at the top of the page to turn automatic calling on or off. Leads from Facebook lead ads,
        website forms and manual entry all start this flow.
      </p>
    );
  }

  if (step.kind === "wait") {
    return (
      <div style={{ maxWidth: 260 }}>
        <Label htmlFor="delay">Wait this long before calling (minutes)</Label>
        <Input
          id="delay"
          type="number"
          min={0}
          max={10080}
          value={flow.triggerDelayMinutes}
          onChange={(e) => patch({ triggerDelayMinutes: Number(e.target.value) })}
        />
        <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: "6px 0 0", lineHeight: 1.5 }}>
          Calling within a few minutes converts far better than the next day. Zero calls the instant the lead lands,
          which some people find startling.
        </p>
      </div>
    );
  }

  if (step.kind === "checks") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <Label>Days it may call</Label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {DAYS.map((d) => {
              const on = flow.windowDays.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  className={on ? "btn btn--primary btn--sm" : "btn btn--outline btn--sm"}
                  onClick={() =>
                    patch({
                      windowDays: on
                        ? flow.windowDays.filter((x) => x !== d.value)
                        : [...flow.windowDays, d.value].sort(),
                    })
                  }
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ width: 150 }}>
            <Label htmlFor="from">Not before</Label>
            <Input id="from" type="time" value={flow.windowStart} onChange={(e) => patch({ windowStart: e.target.value })} />
          </div>
          <div style={{ width: 150 }}>
            <Label htmlFor="to">Not after</Label>
            <Input id="to" type="time" value={flow.windowEnd} onChange={(e) => patch({ windowEnd: e.target.value })} />
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: 0, lineHeight: 1.5 }}>
          Irish time. These hours apply to automatic calls only — calling a lead by hand from their page always works.
          Do-not-call, the spend cap and your remaining minutes are always checked and can&apos;t be turned off here.
        </p>
      </div>
    );
  }

  if (step.kind === "branch") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ width: 220 }}>
            <Label htmlFor="stage">When they answer, move them to</Label>
            <select
              id="stage"
              value={flow.onAnsweredStageRole ?? ""}
              onChange={(e) => patch({ onAnsweredStageRole: e.target.value || null })}
              style={{
                width: "100%",
                background: "var(--bg)",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius)",
                padding: "10px 14px",
                color: "var(--text-primary)",
                fontSize: 14,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              <option value="">Leave the stage alone</option>
              {stageOptions.map((s) => (
                <option key={s.role} value={s.role}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ width: 180 }}>
            <Label htmlFor="retry">Retry after (hours)</Label>
            <Input
              id="retry"
              type="number"
              min={1}
              max={336}
              value={flow.retryAfterHours}
              onChange={(e) => patch({ retryAfterHours: Number(e.target.value) })}
            />
          </div>
          <div style={{ width: 180 }}>
            <Label htmlFor="attempts">Attempts in total</Label>
            <Input
              id="attempts"
              type="number"
              min={1}
              max={10}
              value={flow.maxAttempts}
              onChange={(e) => patch({ maxAttempts: Number(e.target.value) })}
            />
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
          <input
            type="checkbox"
            checked={flow.notifyOnComplete}
            onChange={(e) => patch({ notifyOnComplete: e.target.checked })}
          />
          Email me a summary after each call
        </label>
        <div>
          <Badge>Always on</Badge>
          <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: "6px 0 0", lineHeight: 1.5 }}>
            If someone asks not to be called, they are marked do-not-call immediately and never called again. That
            isn&apos;t configurable — it&apos;s a legal obligation, not a preference.
          </p>
        </div>
      </div>
    );
  }

  return null;
}

/**
 * Re-render the step sentences locally while editing, so the diagram updates as
 * the operator types rather than only after the autosave lands. Mirrors
 * `describeFlow`'s wording for the fields that are editable; everything else is
 * carried through from the server's version unchanged.
 */
function localDescribe(flow: CallFlowConfig, steps: FlowStep[]): FlowStep[] {
  const dayLabel = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const describeDays = (days: number[]) => {
    if (days.length === 7) return "every day";
    if (days.length === 0) return "no days (calling is off)";
    const sorted = [...days].sort();
    if (sorted.join() === "1,2,3,4,5") return "Mon to Fri";
    if (sorted.join() === "0,6") return "weekends";
    return sorted.map((d) => dayLabel[d]).join(", ");
  };
  const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

  return steps.map((s) => {
    if (s.kind === "trigger") {
      return {
        ...s,
        detail: flow.enabled
          ? "From a Facebook lead ad, a website form, or added by hand."
          : "Automatic calling is off — nothing starts this flow. You can still call a lead by hand from their page.",
      };
    }
    if (s.kind === "wait") {
      return {
        ...s,
        detail:
          flow.triggerDelayMinutes === 0
            ? "Call straight away."
            : `Wait ${plural(flow.triggerDelayMinutes, "minute")} before calling.`,
      };
    }
    if (s.kind === "checks") {
      return {
        ...s,
        detail:
          `Only ${describeDays(flow.windowDays)}, between ${flow.windowStart} and ${flow.windowEnd}. ` +
          "Never anyone marked do-not-call. Stops at the monthly spend cap, or when minutes and credits run out.",
      };
    }
    if (s.kind === "branch" && s.branches) {
      return {
        ...s,
        branches: s.branches.map((b) => {
          if (b.label === "They answered") {
            return {
              ...b,
              detail: flow.onAnsweredStageRole
                ? `Move the lead to "${flow.onAnsweredStageRole}".${flow.notifyOnComplete ? " Email you a summary." : ""}`
                : `Leave the stage alone.${flow.notifyOnComplete ? " Email you a summary." : ""}`,
            };
          }
          if (b.label === "No answer") {
            return {
              ...b,
              detail:
                flow.maxAttempts <= 1
                  ? "Don't try again."
                  : `Try again in ${plural(flow.retryAfterHours, "hour")}, up to ${plural(flow.maxAttempts, "attempt")} in total.`,
            };
          }
          return b;
        }),
      };
    }
    return s;
  });
}
