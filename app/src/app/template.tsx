"use client";

import { type ReactNode } from "react";
import { motion } from "motion/react";

import { DUR, EASE } from "@/lib/motion";

/** Runs on every route change. Transform-only (no opacity) so server-rendered
 *  content is never blank before hydration — a subtle rise into place. */
export default function Template({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ y: 6 }}
      animate={{ y: 0 }}
      transition={{ duration: DUR.base, ease: [...EASE] }}
    >
      {children}
    </motion.div>
  );
}
