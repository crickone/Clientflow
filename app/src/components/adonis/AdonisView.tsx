"use client";

import { useState } from "react";
import Link from "next/link";
import { Settings } from "lucide-react";

import { AssistantChat } from "@/components/messaging/AssistantChat";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * The Hermes-template flagship view (`/adonis`): a full-height, minimal home
 * for Adonis's chat — the same `AssistantChat` component + `/api/agents/
 * orchestrator/chat` endpoint already embedded on the dashboard. Adonis (the
 * "orchestrator" agent key) now does the work directly — leads, marketing,
 * operations, and general/admin — with no specialist-routing hop (Adonis
 * merge task); the write-approval gate is completely unchanged either way. A
 * settings gear top-right opens the existing `/agents` page (org chart, model
 * pickers, spend cap — unchanged, just relocated out of the navbar per the
 * sidebar redesign).
 *
 * `bare` (default-off elsewhere) strips AssistantChat's own header + card
 * chrome so the chat blends into a clean full-page background like the Hermes
 * reference. The hero (the Adonis window mark + tagline) is passed as
 * `heroSlot`, so it renders INSIDE the chat's scroll area: centered mid-window
 * while empty, then scrolling up with the conversation once it starts (it's
 * part of the scroll content, not pinned chrome). The window mark is a
 * theme-specific asset (`Logo.tsx`-independent, /adonis only) — see the
 * `.adonis-hero-*` swap in globals.css: the white variant shows on dark, the
 * ink variant on light.
 */
export function AdonisView({
  tenantId,
  isAdmin,
  voiceEnabled,
  initialInput,
}: {
  tenantId: number;
  isAdmin: boolean;
  /** Voice T2: see AssistantChat's `voiceEnabled` doc — computed server-side (page.tsx) via `transcribeConfigured()` and threaded straight through. */
  voiceEnabled: boolean;
  /** Campaign Engine "Build campaign" seed → a pre-filled compose starter (see app/adonis/page.tsx). Undefined for a normal visit. Threaded to AssistantChat's `initialInput`. */
  initialInput?: string;
}) {
  // The Adonis window mark + tagline — rendered at the top of the chat's
  // scroll area (see AssistantChat `heroSlot`). Two theme-specific <img>s,
  // one shown per active theme via the `.adonis-hero-logo--*` CSS in
  // globals.css (dark=white mark, light=ink mark).
  // Big centered mark, capped by viewport height so it never overflows on a
  // short screen. No tagline — the mark owns the centre; the prompt + chips
  // live down by the input (AssistantChat renders them in `bare` mode).
  // /adonis renders AssistantChat's History + New-chat controls in the top bar
  // (top-left) instead of inside the chat: AssistantChat PORTALS them into this
  // container via its `controlsContainer` prop, so all the chat/history state
  // stays inside that one component. A callback ref into state so the portal
  // target is available on the render right after this div mounts.
  const [controlsEl, setControlsEl] = useState<HTMLDivElement | null>(null);

  const logoHeight = "min(clamp(220px, 34vw, 460px), 48vh)";
  const hero = (
    <div
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        padding: "8px 16px 0",
      }}
    >
      <img
        src="/adonis-window-dark.svg"
        alt="Adonis Agent"
        className="adonis-hero-logo adonis-hero-logo--dark"
        style={{ height: logoHeight, width: "auto" }}
      />
      <img
        src="/adonis-window-light.svg"
        alt=""
        aria-hidden
        className="adonis-hero-logo adonis-hero-logo--light"
        style={{ height: logoHeight, width: "auto" }}
      />
    </div>
  );

  return (
    <div
      // `.adonis-shell` owns the height: 100dvh on desktop, but on mobile it
      // subtracts the sticky `.app-topbar` (hamburger row, display:none on
      // desktop) via calc(100dvh - var(--app-topbar-h)) — otherwise topbar +
      // 100dvh overflows the screen and the compose box lands below the fold
      // (see globals.css). Height stays in CSS so the media query can apply.
      className="adonis-shell"
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "18px clamp(14px, 4vw, 24px) 20px",
        boxSizing: "border-box",
      }}
    >
      {/* Top bar: New chat + History on the LEFT (AssistantChat portals its
          controls into the ref'd container below — see its controlsContainer
          prop), the settings gear on the RIGHT. The gear is admin-only: its
          target (/agents) is requireAdminPage()-gated, so we never render one
          that would silently bounce a non-admin. Fixed height so the layout is
          stable whether or not the gear renders. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          minHeight: 36,
        }}
      >
        {/* Portal target for AssistantChat's History + New-chat controls. */}
        <div ref={setControlsEl} style={{ display: "flex", alignItems: "center", gap: 4 }} />
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

      {/* Centered column: capped width so the chat reads like a composer (not
          stretched edge-to-edge on wide monitors). The hero lives INSIDE the
          chat (heroSlot), centered while empty, scrolling up once chatting. */}
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
        <div style={{ flex: 1, minHeight: 0 }}>
          <AssistantChat
            tenantId={tenantId}
            endpoint="/api/agents/orchestrator/chat"
            bare
            heroSlot={hero}
            emptyTitle="Ask for anything — I'll handle it"
            emptyBody=""
            suggestions={[
              "Give me a breakdown of everything important today",
              "Work my leads and win back anyone who's gone quiet",
              "Pull together this month's invoices",
              "Draft a blog about our newest class",
            ]}
            placeholder="Ask Adonis…"
            height="100%"
            voiceEnabled={voiceEnabled}
            initialInput={initialInput}
            controlsContainer={controlsEl}
          />
        </div>
      </div>
    </div>
  );
}
