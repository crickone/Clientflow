"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PhoneCall, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { SaveStatus } from "./SaveStatus";
import { useAutosave } from "./useAutosave";
import {
  provisionVoiceAgentAction,
  saveVoiceSettingsAction,
} from "@/app/settings/voice/actions";
import { formatDateTime } from "@/lib/utils";

interface VoiceConfig {
  agentId: string;
  phoneNumberId: string;
  fromNumber: string;
  voiceId: string;
  persona: string;
  webhookSecret: string;
}

interface Money {
  balanceCents: number;
  capCents: number;
  pricePerMinuteCents: number;
  includedMinutesRemaining: number;
  trialMinutesRemaining: number;
  month: { seconds: number; billedMinutes: number; costCents: number; calls: number };
}

interface CallSummary {
  id: number;
  status: string;
  toNumber: string | null;
  durationSeconds: number;
  costCents: number;
  outcome: string | null;
  createdAt: number;
  leadId: number | null;
}

const eur = (cents: number) => `€${(cents / 100).toFixed(2)}`;
const mmss = (s: number) => `${Math.floor(s / 60)}m ${s % 60}s`;

export function VoiceSettingsView({
  config,
  defaultPersona,
  firstMessage,
  providerConfigured,
  addonStatus,
  money,
  recentCalls,
}: {
  config: VoiceConfig;
  defaultPersona: string;
  firstMessage: string;
  providerConfigured: boolean;
  addonStatus: "trial" | "active" | "cancelled" | null;
  money: Money;
  recentCalls: CallSummary[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState({
    persona: config.persona,
    phoneNumberId: config.phoneNumberId,
    fromNumber: config.fromNumber,
    voiceId: config.voiceId,
  });
  const [provisioning, start] = useTransition();

  const autosave = useAutosave({
    values: draft,
    save: async (v) => {
      const res = await saveVoiceSettingsAction(v);
      if (!res.ok) throw new Error(res.error);
    },
  });

  const enabled = addonStatus === "active" || addonStatus === "trial";

  function provision() {
    start(async () => {
      const res = await provisionVoiceAgentAction();
      if (res.ok) {
        toast.success("Agent saved to the provider — it will use these words on the next call.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!enabled && (
        <Card style={{ padding: 20 }}>
          <CardLabel>Not enabled</CardLabel>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.55, margin: "6px 0 0" }}>
            The Voice Agent add-on isn&apos;t switched on for this account, so no calls can be placed. Talk to us to
            turn it on — you can try it first on free trial minutes.
          </p>
        </Card>
      )}

      {/* Allowances and spend */}
      <Card style={{ padding: 20 }}>
        <CardLabel>This month</CardLabel>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginTop: 10 }}>
          <Stat
            label="Calls"
            value={`${money.month.calls}`}
            sub={`${money.month.billedMinutes} min billed`}
          />
          <Stat
            label={addonStatus === "trial" ? "Trial minutes left" : "Included minutes left"}
            value={`${addonStatus === "trial" ? money.trialMinutesRemaining : money.includedMinutesRemaining}`}
            sub={addonStatus === "trial" ? "free, one-off" : "resets monthly"}
          />
          <Stat label="Spent" value={eur(money.month.costCents)} sub={`cap ${eur(money.capCents)}`} />
          <Stat
            label="Credit balance"
            value={eur(money.balanceCents)}
            sub={`${eur(money.pricePerMinuteCents)}/min after the allowance`}
          />
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: "12px 0 0", lineHeight: 1.5 }}>
          Calls shorter than 20 seconds are never charged. Longer calls round up to the minute. When the cap is
          reached, calling stops for the rest of the month.
        </p>
      </Card>

      {/* What it says */}
      <Card style={{ padding: 20 }}>
        <CardLabel>What it says</CardLabel>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Label>Opening line</Label>
            <p
              style={{
                fontSize: 14,
                color: "var(--text-secondary)",
                background: "var(--surface-2)",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius)",
                padding: "10px 12px",
                margin: "6px 0 0",
                lineHeight: 1.5,
              }}
            >
              {firstMessage}
            </p>
            <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: "6px 0 0", lineHeight: 1.5 }}>
              Fixed, and not editable: the law requires that people are told they are speaking to an AI and that the
              call is recorded.
            </p>
          </div>

          <div>
            <Label htmlFor="persona">How it should behave</Label>
            <Textarea
              id="persona"
              rows={5}
              value={draft.persona}
              placeholder={defaultPersona}
              onChange={(e) => setDraft({ ...draft, persona: e.target.value })}
            />
            <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: "6px 0 0", lineHeight: 1.5 }}>
              Your business details, services and the safety rules are added automatically — the agent never quotes a
              price you haven&apos;t listed, never promises refunds or free sessions, and never makes a health claim.
            </p>
          </div>
        </div>
      </Card>

      {/* Connection */}
      <Card style={{ padding: 20 }}>
        <CardLabel>Connection</CardLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0 14px", flexWrap: "wrap" }}>
          <Badge>{config.agentId ? "Agent connected" : "No agent yet"}</Badge>
          {config.fromNumber && <Badge>Calls from {config.fromNumber}</Badge>}
          {!providerConfigured && <Badge>Provider not configured on this deployment</Badge>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <Label htmlFor="phoneNumberId">Phone number ID</Label>
            <Input
              id="phoneNumberId"
              value={draft.phoneNumberId}
              onChange={(e) => setDraft({ ...draft, phoneNumberId: e.target.value })}
              placeholder="From the provider dashboard"
            />
          </div>
          <div>
            <Label htmlFor="fromNumber">Number shown to the person</Label>
            <Input
              id="fromNumber"
              value={draft.fromNumber}
              onChange={(e) => setDraft({ ...draft, fromNumber: e.target.value })}
              placeholder="+353 …"
            />
          </div>
          <div>
            <Label htmlFor="voiceId">Voice ID</Label>
            <Input
              id="voiceId"
              value={draft.voiceId}
              onChange={(e) => setDraft({ ...draft, voiceId: e.target.value })}
              placeholder="Leave blank for the default voice"
            />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <Button variant="outline" onClick={provision} disabled={provisioning || !providerConfigured || !enabled}>
            <RefreshCw size={14} />
            {provisioning ? "Saving to provider…" : config.agentId ? "Update the agent" : "Create the agent"}
          </Button>
        </div>
      </Card>

      {/* Recent calls */}
      <Card style={{ padding: 20 }}>
        <CardLabel>Recent calls</CardLabel>
        {recentCalls.length === 0 ? (
          <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "8px 0 0" }}>
            No calls yet. Open a lead and press Call to make the first one.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-tertiary)" }}>
                <Th>When</Th>
                <Th>Number</Th>
                <Th>Result</Th>
                <Th>Length</Th>
                <Th>Cost</Th>
              </tr>
            </thead>
            <tbody>
              {recentCalls.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid var(--hairline)" }}>
                  <Td>{formatDateTime(new Date(c.createdAt))}</Td>
                  <Td>
                    {c.leadId ? (
                      <Link href={`/leads/${c.leadId}`} style={{ color: "var(--accent)" }}>
                        {c.toNumber ?? "—"}
                      </Link>
                    ) : (
                      (c.toNumber ?? "—")
                    )}
                  </Td>
                  <Td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <PhoneCall size={13} />
                      {c.status === "no_answer" ? "No answer" : c.status === "failed" ? "Failed" : "Completed"}
                    </span>
                    {c.outcome && (
                      <div style={{ color: "var(--text-tertiary)", fontSize: 12.5, marginTop: 2 }}>{c.outcome}</div>
                    )}
                  </Td>
                  <Td>{mmss(c.durationSeconds)}</Td>
                  <Td>{c.costCents > 0 ? eur(c.costCents) : "—"}</Td>
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "6px 8px", fontWeight: 500 }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "8px" }}>{children}</td>;
}
