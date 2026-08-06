import type { Variants } from "motion/react";

/** Duration tokens (seconds). Subtle & premium — fast micro-interactions. */
export const DUR = { fast: 0.12, base: 0.18, slow: 0.28 } as const;

/** Ease-out curve (matches globals.css --ease). No spring/bounce by design. */
export const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Only the first N children of a list stagger; the rest appear instantly. */
export const STAGGER_CAP = 10;

/** Fade + rise into place. Used by <Reveal>. */
export const revealVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } },
};

/** Container that staggers its <Reveal> children. */
export function staggerContainer(stagger = 0.04): Variants {
  return {
    hidden: {},
    visible: { transition: { staggerChildren: stagger } },
  };
}
