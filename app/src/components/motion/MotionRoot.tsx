"use client";

import { type ReactNode } from "react";
import { MotionConfig } from "motion/react";

import { DUR, EASE } from "@/lib/motion";

/** App-wide motion defaults + global reduced-motion handling (one place). */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: DUR.base, ease: [...EASE] }}>
      {children}
    </MotionConfig>
  );
}
