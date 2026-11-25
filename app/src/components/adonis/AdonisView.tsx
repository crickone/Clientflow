"use client";

import Link from "next/link";
import { Settings } from "lucide-react";

import { Tooltip } from "@/components/ui/Tooltip";
import { AdonisChat } from "./chat/AdonisChat";
import { ModelPicker } from "./ModelPicker";

const SUGGESTIONS = [
  "How are my ads doing this week?",
  "Reply to today's leads",
  "Plan next week's posts",
  "Who hasn't booked in 30 days?",
];

/**
 * The /adonis page: Adonis's chat, full height (components/adonis/chat).
 * The settings gear, admin-only because its target (/agents) is
 * requireAdminPage()-gated, sits at the right of the chat's top bar. The
 * model chip lives in the composer.
 */
export function AdonisView({
  tenantId,
  isAdmin,
  voiceEnabled,
  initialInput,
  model,
  openRouterConfigured,
  firstName,
  businessName,
}: {
  tenantId: number;
  isAdmin: boolean;
  /** Server-computed via transcribeConfigured(); the client never reads process.env. */
  voiceEnabled: boolean;
  /** A "Build campaign" seed for the compose box (see app/adonis/page.tsx). */
  initialInput?: string;
  /** Adonis's current agents.model, shown (and for an admin switchable) in the composer. */
  model: string;
  /** Whether the open (non-Claude) models can run. */
  openRouterConfigured: boolean;
  firstName: string | null;
  businessName: string;
}) {
  return (
    // `.adonis-shell` owns the height (100dvh, less the mobile top bar; see globals.css).
    <div
      className="adonis-shell"
      style={{ display: "flex", flexDirection: "column", padding: "12px clamp(8px, 3vw, 20px) 0", boxSizing: "border-box" }}
    >
      <AdonisChat
        tenantId={tenantId}
        agentKey="orchestrator"
        isAdmin={isAdmin}
        firstName={firstName}
        businessName={businessName}
        suggestions={SUGGESTIONS}
        voiceEnabled={voiceEnabled}
        initialInput={initialInput}
        modelChip={<ModelPicker agentKey="orchestrator" initialModel={model} canEdit={isAdmin} openRouterConfigured={openRouterConfigured} />}
        headerEnd={
          isAdmin ? (
            <Tooltip label="Agent settings">
              <Link href="/agents" aria-label="Agent settings" className="ax-top-btn" style={{ padding: 0, width: 36 }}>
                <Settings size={17} strokeWidth={1.75} />
              </Link>
            </Tooltip>
          ) : null
        }
      />
    </div>
  );
}
