"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

/** Right-anchored, full-height slide-over panel (used for detail views). */
export const Sheet = DialogPrimitive.Root;
export const SheetClose = DialogPrimitive.Close;

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    title?: string;
    width?: number;
  }
>(({ children, title, width = 460, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      className="anim-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8,8,8,0.44)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        zIndex: 60,
      }}
    />
    <DialogPrimitive.Content
      ref={ref}
      aria-describedby={undefined}
      className="anim-sheet"
      {...props}
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        height: "100vh",
        width: `min(96vw, ${width}px)`,
        background: "var(--surface-1)",
        borderLeft: "1px solid var(--hairline)",
        boxShadow: "var(--shadow-2)",
        zIndex: 70,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid var(--hairline)",
          flexShrink: 0,
        }}
      >
        <DialogPrimitive.Title
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: 17,
            fontWeight: 400,
            textTransform: "uppercase",
            letterSpacing: "0.02em",
            color: "var(--text-primary)",
            margin: 0,
          }}
        >
          {title}
        </DialogPrimitive.Title>
        <DialogPrimitive.Close
          aria-label="Close"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-tertiary)",
            cursor: "pointer",
            padding: 6,
            borderRadius: "var(--radius)",
            display: "inline-flex",
          }}
        >
          <X size={18} />
        </DialogPrimitive.Close>
      </div>
      <div style={{ overflowY: "auto", padding: 20, flex: 1 }}>{children}</div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";
