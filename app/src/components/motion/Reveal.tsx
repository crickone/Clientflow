"use client";

import { type CSSProperties, type ReactNode, createContext, useContext, useState } from "react";
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
  immediate = false,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  stagger?: number;
  /** Drive children to "visible" via a persistent `animate` instead of a
   *  one-shot, scroll-triggered `whileInView`. Use this for DYNAMIC content
   *  whose children change after the first reveal (e.g. a filtered list): with
   *  `whileInView` + `viewport.once`, once the group has fired its single
   *  in-view trigger it stops propagating "visible", so any child that mounts
   *  AFTERWARD (a new category group appearing on a filter switch) inherits
   *  only `initial="hidden"` and is stuck at opacity 0 — the list vanishes.
   *  `animate` keeps driving "visible" so newly-mounted children always resolve.
   *  Default (false) waits for the group to scroll into view first, then holds
   *  "visible" the same way, so late children resolve either way. */
  immediate?: boolean;
}) {
  // Once the group has scrolled into view, hold it at "visible" with a
  // persistent `animate`. `whileInView` + `once` fires a single time, so a
  // child that mounts later (a filter tab switched back, a search cleared, a
  // row added by router.refresh) would otherwise inherit only "hidden" and sit
  // invisible in its grid slot. Holding "visible" makes late children resolve.
  const [seen, setSeen] = useState(immediate);
  return (
    <InRevealGroup.Provider value={true}>
      <motion.div
        className={className}
        style={style}
        variants={staggerContainer(stagger)}
        initial="hidden"
        animate={seen ? "visible" : undefined}
        whileInView={seen ? undefined : "visible"}
        viewport={seen ? undefined : { once: true, margin: "-40px" }}
        onViewportEnter={seen ? undefined : () => setSeen(true)}
      >
        {children}
      </motion.div>
    </InRevealGroup.Provider>
  );
}
