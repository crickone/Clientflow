"use client";

import { useState } from "react";
import { LayoutTemplate, Sparkles } from "lucide-react";

import type { ImageLibraryAsset } from "@/lib/db/schema";
import type { BrandLabels } from "@/lib/image/paintSlide";
import { StartDesign } from "./StartDesign";
import { TemplateGallery } from "./TemplateGallery";

/**
 * The two ways to start a post, side by side.
 *
 * AI Generation is the default because it is the shorter road: say what the
 * post is about and the copy — and, for a tenant with a design system, the
 * layout — is written for you. Templates is the other road, for someone who
 * already knows the look they want and would rather write the words
 * themselves.
 *
 * They are tabs rather than two pages because the choice between them is not
 * a decision worth a navigation step; it is the same task approached from two
 * directions, and seeing both makes the second one discoverable at all.
 */
type Tab = "ai" | "templates";

export function StartTabs({
  library,
  brand,
  defaultHeadingFontId,
  defaultBodyFontId,
  logoUrl,
  accentColor,
  /** Whether this tenant has a design system — it changes what the AI tab
   *  actually does, so it changes what the tab promises. */
  hasDesignSystem = false,
}: {
  library: ImageLibraryAsset[];
  brand?: BrandLabels;
  defaultHeadingFontId: string;
  defaultBodyFontId: string;
  logoUrl: string | null;
  accentColor?: string;
  hasDesignSystem?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("ai");

  const TABS: { id: Tab; label: string; icon: typeof Sparkles }[] = [
    { id: "ai", label: "AI generation", icon: Sparkles },
    { id: "templates", label: "Templates", icon: LayoutTemplate },
  ];

  return (
    <div>
      <div
        role="tablist"
        aria-label="How to start"
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 22,
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setTab(id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "10px 14px",
                background: "none",
                border: "none",
                borderBottom: `2px solid ${active ? "var(--text-primary)" : "transparent"}`,
                marginBottom: -1,
                color: active ? "var(--text-primary)" : "var(--text-tertiary)",
                fontSize: 13.5,
                fontWeight: active ? 600 : 500,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              <Icon size={15} />
              {label}
            </button>
          );
        })}
      </div>

      {tab === "ai" ? (
        <div role="tabpanel">
          {hasDesignSystem && (
            <p
              style={{
                margin: "0 0 18px",
                fontSize: 13,
                color: "var(--text-secondary)",
                maxWidth: "62ch",
              }}
            >
              Adonis composes each slide&rsquo;s layout from your own design
              system — its grounds, its type scale, its grid — and checks every
              one against your brand&rsquo;s contrast and rotation rules before
              you see it.
            </p>
          )}
          <StartDesign />
        </div>
      ) : (
        <div role="tabpanel">
          <TemplateGallery
            library={library}
            brand={brand}
            defaultHeadingFontId={defaultHeadingFontId}
            defaultBodyFontId={defaultBodyFontId}
            logoUrl={logoUrl}
            accentColor={accentColor}
          />
        </div>
      )}
    </div>
  );
}
