"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    title?: string;
    description?: string;
    width?: number;
  }
>(({ children, title, description, width = 560, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,10,10,0.32)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        zIndex: 60,
        animation: "fade-up 0.18s var(--ease)",
      }}
    />
    <DialogPrimitive.Content
      ref={ref}
      {...props}
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(94vw, " + width + "px)",
        maxHeight: "92vh",
        overflowY: "auto",
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow-2)",
        zIndex: 70,
        padding: 28,
        animation: "fade-up 0.22s var(--ease)",
      }}
    >
      {title && (
        <DialogPrimitive.Title
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: 22,
            fontWeight: 400,
            textTransform: "uppercase",
            color: "var(--text-primary)",
            marginBottom: description ? 8 : 20,
          }}
        >
          {title}
        </DialogPrimitive.Title>
      )}
      {description && (
        <DialogPrimitive.Description
          style={{
            color: "var(--text-secondary)",
            fontSize: 14,
            marginBottom: 20,
          }}
        >
          {description}
        </DialogPrimitive.Description>
      )}
      {children}
      <DialogPrimitive.Close
        aria-label="Close"
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          background: "transparent",
          border: "none",
          color: "var(--text-tertiary)",
          cursor: "pointer",
          padding: 6,
          borderRadius: "var(--radius)",
          display: "inline-flex",
        }}
      >
        <X size={16} />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";
