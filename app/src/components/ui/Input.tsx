"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, style, ...rest }, ref) => (
  <input
    ref={ref}
    className={cn(className)}
    style={{
      width: "100%",
      background: "var(--surface-1)",
      border: "1px solid var(--grid)",
      borderRadius: "var(--radius)",
      padding: "10px 14px",
      color: "var(--text-primary)",
      fontSize: 14,
      outline: "none",
      fontFamily: "inherit",
      transition: "border-color 0.15s var(--ease)",
      ...style,
    }}
    {...rest}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, style, ...rest }, ref) => (
  <textarea
    ref={ref}
    className={cn(className)}
    style={{
      width: "100%",
      background: "var(--surface-1)",
      border: "1px solid var(--grid)",
      borderRadius: "var(--radius)",
      padding: "10px 14px",
      color: "var(--text-primary)",
      fontSize: 14,
      outline: "none",
      fontFamily: "inherit",
      minHeight: 90,
      resize: "vertical",
      transition: "border-color 0.15s var(--ease)",
      ...style,
    }}
    {...rest}
  />
));
Textarea.displayName = "Textarea";

export function Label({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: "block",
        fontSize: 12,
        fontWeight: 500,
        color: "var(--text-secondary)",
        marginBottom: 6,
        letterSpacing: "-0.005em",
      }}
    >
      {children}
    </label>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      style={{
        color: "#dc2626",
        fontSize: 12,
        marginTop: 4,
      }}
    >
      {message}
    </div>
  );
}
