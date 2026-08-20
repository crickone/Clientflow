"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";

import { Tooltip } from "@/components/ui/Tooltip";
import {
  resolveThemeVars,
  themeForMode,
  THEME_MODE_COOKIE,
  type ThemeMode,
} from "@/lib/theme";

/**
 * Small sun/moon toggle for the sidebar footer — flips the whole admin app
 * between light and dark. `initialMode` is the SSR-resolved mode (from the
 * `ui-theme` cookie, read in layout.tsx), so the icon is correct on first
 * paint with no flash.
 *
 * On click it (1) writes the `ui-theme` cookie so the server injects the
 * matching palette on the next load, and (2) applies the new palette INSTANTLY
 * by setting the derived vars inline on <html> (inline wins over the injected
 * <style>) + flipping `data-theme` — the same mechanism AppearanceView uses for
 * its live preview. `--font-heading` is deliberately skipped so the tenant's
 * chosen heading font is never clobbered (it's mode-independent).
 */
export function ThemeToggle({ initialMode }: { initialMode: ThemeMode }) {
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  const next: ThemeMode = mode === "dark" ? "light" : "dark";

  function flip() {
    const root = document.documentElement;
    for (const [k, v] of resolveThemeVars(themeForMode(next))) {
      if (k === "--font-heading") continue; // mode-independent; keep tenant's font
      if (k === "color-scheme") root.style.colorScheme = v;
      else root.style.setProperty(k, v);
    }
    root.dataset.theme = next;
    document.cookie = `${THEME_MODE_COOKIE}=${next}; path=/; max-age=31536000; SameSite=Lax`;
    setMode(next);
  }

  return (
    <Tooltip label={`Switch to ${next} mode`}>
      <button
        onClick={flip}
        aria-label={`Switch to ${next} mode`}
        className="nav-link"
        style={{
          border: "1px solid transparent",
          borderRadius: "var(--radius)",
          padding: 6,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-secondary)",
        }}
      >
        {mode === "dark" ? <Sun size={15} strokeWidth={1.75} /> : <Moon size={15} strokeWidth={1.75} />}
      </button>
    </Tooltip>
  );
}
