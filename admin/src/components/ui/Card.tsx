"use client";

import * as React from "react";
import { motion } from "motion/react";

const DUR_FAST = 0.12;
const EASE = [0.2, 0.8, 0.2, 1] as const;

const baseStyle: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--grid)",
  borderRadius: "var(--radius)",
  padding: 24,
  boxShadow: "var(--shadow-1)",
};

export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }
>(({ children, style, interactive, ...rest }, ref) => {
  if (!interactive) {
    return (
      <div ref={ref} style={{ ...baseStyle, ...style }} {...rest}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      ref={ref}
      style={{ ...baseStyle, cursor: "pointer", ...style }}
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
