"use client";

import * as React from "react";
import { motion } from "motion/react";

import { DUR, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The look lives in CSS (`.ui-card` in globals.css): the surface sheen, the
 * top-edge highlight, the elevation shadows and the cursor spotlight are
 * layered backgrounds and :hover states that inline styles can't express. A
 * caller's `style` still wins, since inline beats the class.
 */
export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }
>(({ children, className, interactive, ...rest }, ref) => {
  if (!interactive) {
    return (
      <div ref={ref} className={cn("ui-card", className)} {...rest}>
        {children}
      </div>
    );
  }
  // Framer owns the transform (lift + press); the shadow and border shift on
  // hover are CSS transitions on .ui-card--interactive, so the two never fight.
  return (
    <motion.div
      ref={ref}
      className={cn("ui-card ui-card--interactive", className)}
      whileHover={{ y: -2 }}
      whileTap={{ y: 0, scale: 0.995 }}
      transition={{ duration: DUR.fast, ease: [...EASE] }}
      {...(rest as React.ComponentProps<typeof motion.div>)}
    >
      {children}
    </motion.div>
  );
});
Card.displayName = "Card";

export function CardLabel({
  children,
  style,
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
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function CardValue({
  children,
  style,
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
        ...style,
      }}
    >
      {children}
    </div>
  );
}
