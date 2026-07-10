"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "destructive" | "outline";
type Size = "sm" | "md" | "lg" | "icon";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
}

const baseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  fontFamily: "var(--font-mono), ui-monospace, monospace",
  fontWeight: 400,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  borderRadius: "var(--radius)",
  cursor: "pointer",
  transition: "background 0.15s var(--ease), color 0.15s var(--ease), border-color 0.15s var(--ease)",
  whiteSpace: "nowrap",
  border: "1px solid transparent",
};

const sizes: Record<Size, React.CSSProperties> = {
  sm: { fontSize: 11, padding: "6px 14px", height: 32 },
  md: { fontSize: 12, padding: "9px 18px", height: 38 },
  lg: { fontSize: 13, padding: "11px 22px", height: 44 },
  icon: { padding: 0, width: 36, height: 36, borderRadius: "var(--radius)" },
};

const variants: Record<Variant, React.CSSProperties> = {
  primary: {
    background: "var(--accent)",
    color: "#1a0a03",
    boxShadow: "var(--accent-glow)",
    fontWeight: 600,
  },
  secondary: {
    background: "var(--surface-2)",
    color: "var(--text-primary)",
    borderColor: "var(--grid)",
  },
  outline: {
    background: "transparent",
    color: "var(--text-primary)",
    borderColor: "var(--hairline-strong)",
  },
  ghost: {
    background: "transparent",
    color: "var(--text-secondary)",
  },
  destructive: {
    background: "#dc2626",
    color: "#ffffff",
  },
};

export const Button = React.forwardRef<HTMLButtonElement, Props>(
  (
    { variant = "primary", size = "md", className, style, ...rest },
    ref,
  ) => (
    <button
      ref={ref}
      className={cn(className)}
      style={{ ...baseStyle, ...sizes[size], ...variants[variant], ...style }}
      {...rest}
    />
  ),
);
Button.displayName = "Button";
