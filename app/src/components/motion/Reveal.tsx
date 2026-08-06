"use client";

import { type CSSProperties, type ReactNode, createContext, useContext } from "react";
import { motion } from "motion/react";

import { revealVariants, staggerContainer } from "@/lib/motion";

/** True when a <Reveal> is inside a <RevealGroup>, so the group (not the child)
 *  owns the in-view trigger and can stagger its children. */
const InRevealGroup = createContext(false);

/**
 * Fades + rises its children into place. Standalone it triggers on scroll-into-
 * view (once). Inside a <RevealGroup> it becomes variant-only so the group can
 * drive the staggered timing. A thin client shell — children are server-rendered.
 */
export function Reveal({
  children,
  className,
  style,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "li";
}) {
  const inGroup = useContext(InRevealGroup);
  const Tag = as === "li" ? motion.li : motion.div;
  if (inGroup) {
    return (
      <Tag className={className} style={style} variants={revealVariants}>
        {children}
      </Tag>
    );
  }
  return (
    <Tag
      className={className}
      style={style}
      variants={revealVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-40px" }}
    >
      {children}
    </Tag>
  );
}

/**
 * Staggers its direct <Reveal> children. The group owns the in-view trigger and
 * variant propagation; each child inherits the visible state in sequence.
 */
export function RevealGroup({
  children,
  className,
  style,
  stagger,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  stagger?: number;
}) {
  return (
    <InRevealGroup.Provider value={true}>
      <motion.div
        className={className}
        style={style}
        variants={staggerContainer(stagger)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-40px" }}
      >
        {children}
      </motion.div>
    </InRevealGroup.Provider>
  );
}
