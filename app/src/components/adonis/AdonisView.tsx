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
 * AssistantChat renders its OWN bordered card with its own header bar and
 * its own internal empty-state (icon/title/body/suggestions) — it exposes no
 * prop to swap or suppress that in favour of a custom hero, and per the task
 * brief this is NOT a reason to fork/rewrite it. So the hero below is a
 * static block ABOVE the chat card (not something that dynamically
 * shrinks/hides once a conversation starts — this component has no way to
 * observe AssistantChat's message state) and it's fine for it to stay put;
 * AssistantChat's own empty-state still collapses away once the visitor
 * sends a first message, exactly as it already does on the dashboard.
 */
export function AdonisView({ tenantId }: { tenantId: number }) {
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
      {/* Top bar — minimal: just the settings gear, top-right. */}
      <div style={{ display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
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
            title="Adonis"
            subtitle="routes any request to the right agent — sales, marketing, ops, or your general concierge"
            emptyTitle="Ask for anything — I'll route it"
            emptyBody="Tell me what you need and I'll hand it to the right agent: chasing leads, drafting content, recovering no-shows, or the general stuff — your inbox, invoices, money, and plans. Nothing sends or changes without your approval."
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
