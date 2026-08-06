"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "destructive" | "outline";
type Size = "sm" | "md" | "lg" | "icon";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and disables the button (prevents double-submit). */
  loading?: boolean;
}

/**
 * The look lives in CSS (`.btn` + `.btn--{variant}` + `.btn--{size}` in
 * globals.css) so hover / active / focus-visible / disabled actually work —
 * inline styles can't express pseudo-classes. A caller's `style` prop still
 * overrides, since inline styles beat classes.
 */
export const Button = React.forwardRef<HTMLButtonElement, Props>(
  ({ variant = "primary", size = "md", loading = false, className, disabled, children, ...rest }, ref) => (
    <button
      ref={ref}
      className={cn("btn", `btn--${variant}`, `btn--${size}`, loading && "btn--loading", className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="spin" size={size === "sm" ? 13 : 15} aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
