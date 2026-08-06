"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

/** Mount once high in the tree so tooltips share hover-open timing. */
export const TooltipProvider = TooltipPrimitive.Provider;

/**
 * Themed tooltip. Wrap the trigger element:
 *   <Tooltip label="Sign out"><button>…</button></Tooltip>
 * Replaces the native `title=` attribute (unstyled, slow, light).
 */
export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          style={{
            background: "var(--surface-3)",
            border: "1px solid var(--hairline)",
            color: "var(--text-primary)",
            fontSize: 12,
            padding: "5px 9px",
            borderRadius: "var(--radius-sm)",
            boxShadow: "var(--shadow-1)",
            zIndex: 95,
            maxWidth: 240,
            animation: "fade-up 0.12s var(--ease)",
          }}
        >
          {label}
          <TooltipPrimitive.Arrow style={{ fill: "var(--surface-3)" }} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
