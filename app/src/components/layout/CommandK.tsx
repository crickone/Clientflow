"use client";

import { useEffect, useState } from "react";

import { CommandPalette } from "./CommandPalette";
import { pathAllowed, type FeatureFlags } from "@/lib/features";
import { resolveAppShortcut } from "@/lib/ui/shortcuts";
import type { Vocab } from "@/lib/vocabulary";

/**
 * The app-wide keymap and the surface it opens.
 *
 * Lifted out of AppShell because AppShell is not the only shell. The root
 * layout returns four different documents — the sidebar app, the full-screen
 * Studio, the client mobile app and the public site — and Cmd+K lived inside
 * one of them, so it died on the others. A binding that works on most screens
 * is worse than one that works on none: the operator stops reaching for it.
 *
 * Every prop here is serialisable on purpose. `pathAllowed` is built from the
 * flags INSIDE this component rather than passed in, so a server component can
 * mount it directly (a function prop cannot cross that boundary).
 */
export function CommandK({
  isAdmin,
  mode,
  tenantSlug,
  vocab,
  featureFlags,
}: {
  isAdmin: boolean;
  mode: "appointments" | "timetable";
  tenantSlug: string;
  vocab: Vocab;
  /** Modules this business has; a switched-off one is not offered. */
  featureFlags: FeatureFlags;
}) {
  const [palette, setPalette] = useState<null | "commands" | "help">(null);

  // One window listener for the whole app. The bindings themselves live in
  // @/lib/ui/shortcuts, which is pure and tested; this only wires them up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = resolveAppShortcut({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        target: e.target as {
          tagName?: string;
          isContentEditable?: boolean;
        } | null,
      });
      if (!action) return;

      // Esc and the palette's own keys belong to the palette while it is open.
      if (palette) {
        if (action === "close") {
          e.preventDefault();
          setPalette(null);
        }
        return;
      }

      // Anything else with a dialog open is that dialog's business. The
      // `:not([data-state="closed"])` form is REQUIRED: Radix keeps content
      // mounted mid-exit-animation carrying data-state="closed", and the
      // hand-rolled panels set role="dialog" with no data-state at all. This
      // is the same guard the designer's keymap needed — see
      // @/lib/content-studio/shortcuts and the note in ImageDesigner.
      const dialogOpen = document.querySelector(
        '[role="dialog"]:not([data-state="closed"])',
      );

      if (action === "palette") {
        e.preventDefault();
        setPalette("commands");
        return;
      }
      if (dialogOpen) return;

      if (action === "help") {
        e.preventDefault();
        setPalette("help");
        return;
      }
      if (action === "search") {
        const box = document.querySelector<HTMLInputElement>(
          'input[type="search"], input[data-search]',
        );
        if (box) {
          e.preventDefault();
          box.focus();
          box.select();
        }
        return;
      }
      if (action === "submit") {
        // Submit the form the focus is in — and ONLY if its submit control is
        // live. requestSubmit() ignores a disabled button, which is how two
        // presses once started two metered runs in the designer.
        const form = (e.target as HTMLElement | null)?.closest?.("form");
        if (!form) return;
        const submit = form.querySelector<HTMLButtonElement>(
          'button[type="submit"], button:not([type])',
        );
        if (submit?.disabled) return;
        e.preventDefault();
        form.requestSubmit(submit ?? undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [palette]);

  return (
    <CommandPalette
      open={palette !== null}
      showHelp={palette === "help"}
      onClose={() => setPalette(null)}
      ctx={{
        isAdmin,
        mode,
        tenantSlug,
        vocab: vocab as unknown as Record<string, string>,
        // The layout refuses a route whose module is switched off; the palette
        // must not offer it, or the two disagree in front of the user.
        pathAllowed: (href) => pathAllowed(featureFlags, href),
      }}
    />
  );
}
