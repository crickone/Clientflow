"use client";

import * as React from "react";
import { motion } from "motion/react";

const DUR_FAST = 0.12;
const EASE = [0.2, 0.8, 0.2, 1] as const;

export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }
>(({ children, style, interactive, className, ...rest }, ref) => {
  // The surface lives in .card (globals.css) so it can carry a gradient and
  // stay in one place; style still overrides per call (padding, gap).
  const cls = className ? `card ${className}` : "card";
  if (!interactive) {
    return (
      <div ref={ref} className={cls} style={style} {...rest}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      ref={ref}
      className={cls}
      style={{ cursor: "pointer", ...style }}
      whileHover={{ y: -2, boxShadow: "var(--shadow-2)", borderColor: "var(--hairline-strong)" }}
      whileTap={{ y: 1 }}
      transition={{ duration: DUR_FAST, ease: [...EASE] }}
      {...(rest as React.ComponentProps<typeof motion.div>)}
    >
      {children}
    </motion.div>
  );
});
Card.displayName = "Card";

export function CardLabel({
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={{
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: 10,
        fontWeight: 400,
        color: "var(--text-tertiary)",
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

export function CardValue({
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={{
        fontFamily: "var(--font-heading), sans-serif",
        fontSize: 36,
        fontWeight: 400,
        color: "var(--text-primary)",
        lineHeight: 1,
        textTransform: "uppercase",
        letterSpacing: 0,
      }}
    >
      {children}
    </div>
  );
}
