"use client";

import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as React from "react";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>
>(({ style, sideOffset = 6, ...props }, ref) => (
  <DropdownPrimitive.Portal>
    <DropdownPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      style={{
        minWidth: 200,
        background: "var(--surface-1)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow-2)",
        padding: 6,
        zIndex: 90,
        animation: "fade-up 0.14s var(--ease)",
        ...style,
      }}
      {...props}
    />
  </DropdownPrimitive.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & { destructive?: boolean }
>(({ style, destructive, ...props }, ref) => (
  <DropdownPrimitive.Item
    ref={ref}
    className="dropdown-item"
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 10px",
      borderRadius: "var(--radius-sm)",
      fontSize: 13,
      color: destructive ? "#f87171" : "var(--text-secondary)",
      cursor: "pointer",
      outline: "none",
      userSelect: "none",
      ...style,
    }}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuLabel = ({ children }: { children: React.ReactNode }) => (
  <DropdownPrimitive.Label
    style={{
      padding: "6px 10px 8px",
      fontFamily: "var(--font-mono), ui-monospace, monospace",
      fontSize: 10.5,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "var(--text-tertiary)",
    }}
  >
    {children}
  </DropdownPrimitive.Label>
);

export const DropdownMenuSeparator = () => (
  <DropdownPrimitive.Separator style={{ height: 1, background: "var(--hairline)", margin: "6px 0" }} />
);
