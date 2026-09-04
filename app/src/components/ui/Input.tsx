"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Truthy = the field is in error (a `string` reason is accepted so callers
 * can pass the same value they hand to `FieldError` without coercing it). */
type FieldErrorProp = boolean | string | undefined;

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { error?: FieldErrorProp }
>(({ className, style, error, "aria-invalid": ariaInvalid, ...rest }, ref) => (
  <input
    ref={ref}
    className={cn("field", error && "field--error", className)}
    aria-invalid={error ? true : ariaInvalid}
    style={{
      width: "100%",
      background: "var(--field-bg)",
      border: "1px solid transparent",
      borderRadius: "var(--radius-field)",
      padding: "13px 16px",
      color: "var(--text-primary)",
      fontSize: 14.5,
      outline: "none",
      fontFamily: "inherit",
      transition: "border-color 0.15s var(--ease), box-shadow 0.15s var(--ease)",
      ...(error ? { borderColor: "#dc2626" } : null),
      ...style,
    }}
    {...rest}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: FieldErrorProp }
>(({ className, style, error, "aria-invalid": ariaInvalid, ...rest }, ref) => (
  <textarea
    ref={ref}
    className={cn("field", error && "field--error", className)}
    aria-invalid={error ? true : ariaInvalid}
    style={{
      width: "100%",
      background: "var(--field-bg)",
      border: "1px solid transparent",
      borderRadius: "var(--radius-field)",
      padding: "13px 16px",
      color: "var(--text-primary)",
      fontSize: 14.5,
      outline: "none",
      fontFamily: "inherit",
      minHeight: 90,
      resize: "vertical",
      transition: "border-color 0.15s var(--ease), box-shadow 0.15s var(--ease)",
      ...(error ? { borderColor: "#dc2626" } : null),
      ...style,
    }}
    {...rest}
  />
));
Textarea.displayName = "Textarea";

export function Label({
  children,
  htmlFor,
  srOnly,
}: {
  children: React.ReactNode;
  htmlFor?: string;
  /**
   * Hide the label visually but keep it for screen readers. Used where the
   * field carries its name as placeholder text instead of a heading above it
   * (the house field style) — the accessible name must survive even though
   * nothing is drawn. Labels for NON-input controls (button groups, swatches,
   * pickers) stay visible: their text can't live in a placeholder.
   */
  srOnly?: boolean;
}) {
  if (srOnly) {
    return (
      <label htmlFor={htmlFor} className="sr-only">
        {children}
      </label>
    );
  }
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
