"use client";

import Link from "next/link";
import { Settings } from "lucide-react";

import { AssistantChat } from "@/components/messaging/AssistantChat";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * The Hermes-template flagship view (`/adonis`): a full-height, minimal home
 * for the Orchestrator ("Adonis") chat — the same `AssistantChat` component
 * + `/api/agents/orchestrator/chat` endpoint already embedded on the
 * dashboard, so specialist routing + the write-approval gate are completely
 * unchanged. A big centered ADONIS AGENT wordmark + tagline sit above the
 * chat; a settings gear top-right opens the existing `/agents` page (org
 * chart, model pickers, spend cap — unchanged, just relocated out of the
 * navbar per the sidebar redesign).
 *
 * The hero below is a static block ABOVE the chat card. To keep the view
 * "clean like the Hermes reference" — one identity block, not two — we pass
 * AssistantChat the additive, default-off `hideHeader` prop, which suppresses
 * ITS internal identity header (icon + title + subtitle) and the big
 * empty-state icon so they don't stack redundantly beneath our wordmark;
 * History + New-chat controls stay (a slim right-aligned strip) and the
 * dashboard/specialist chats are untouched (they don't set the prop). We also
 * pass an empty `emptyBody` so only the short prompt + suggestions show. The
 * hero doesn't shrink/hide once a conversation starts (this component can't
 * observe AssistantChat's message state) — fine, it just sits above the chat.
 */
export function AdonisView({
  tenantId,
  isAdmin,
}: {
  tenantId: number;
  isAdmin: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        padding: "18px clamp(14px, 4vw, 24px) 20px",
        boxSizing: "border-box",
      }}
    >
      {/* Top bar — minimal: just the settings gear, top-right. Admin-only:
          its target (/agents) is requireAdminPage()-gated, so we never render
          a gear that would silently bounce a non-admin staff user. The row is
          kept (fixed height) for both so the hero's vertical rhythm is stable. */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          flexShrink: 0,
          minHeight: 36,
        }}
      >
        {isAdmin && (
          <Tooltip label="Agent settings">
            <Link
              href="/agents"
              aria-label="Agent settings"
              className="nav-link"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                borderRadius: "var(--radius)",
                color: "var(--text-secondary)",
                flexShrink: 0,
              }}
            >
              <Settings size={18} strokeWidth={1.75} />
            </Link>
          </Tooltip>
        )}
      </div>

      {/* Centered column: hero + chat, capped width so the chat reads like a
          composer (not stretched edge-to-edge on wide monitors). */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          width: "100%",
          maxWidth: 840,
          margin: "0 auto",
        }}
      >
        {/* Hero — the ADONIS AGENT wordmark, rendered as a currentColor CSS
            mask exactly like Logo.tsx's fallback lockup (same asset,
            /adonis-logo.svg, so it stays theme-adaptive across light/dark
            and any per-tenant accent), plus the one-line tagline beneath it. */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "clamp(20px, 5dvh, 56px) 16px clamp(16px, 4dvh, 32px)",
          }}
        >
          <span
            role="img"
            aria-label="Adonis Agent"
            style={{
              display: "block",
              height: "clamp(40px, 8vw, 68px)",
              width: "auto",
              aspectRatio: "1500 / 645", // matches /adonis-logo.svg's cropped viewBox
              color: "var(--text-primary)",
              backgroundColor: "currentColor",
              WebkitMaskImage: "url(/adonis-logo.svg)",
              maskImage: "url(/adonis-logo.svg)",
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
              WebkitMaskSize: "contain",
              maskSize: "contain",
              WebkitMaskPosition: "center",
              maskPosition: "center",
            }}
          />
          <div
            style={{
              marginTop: 14,
              fontSize: 14,
              color: "var(--text-secondary)",
              letterSpacing: "0.01em",
            }}
          >
            Turning Conversations Into Campaigns
          </div>
        </div>

        {/* The chat — fills all remaining height; its own input row is the
            last flex child of AssistantChat's internal column, so it stays
            pinned at the bottom of this card exactly like the Hermes
            reference (unchanged internals — see the module doc comment). */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <AssistantChat
            tenantId={tenantId}
            endpoint="/api/agents/orchestrator/chat"
            hideHeader
            emptyTitle="Ask for anything — I'll route it"
            emptyBody=""
            suggestions={[
              "Give me a breakdown of everything important today",
              "Work my leads and win back anyone who's gone quiet",
              "Pull together this month's invoices",
              "Draft a blog about our newest class",
            ]}
            placeholder="Ask Adonis…"
            height="100%"
          />
        </div>
      </div>
    </div>
  );
}
