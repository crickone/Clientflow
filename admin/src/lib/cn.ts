/** Tiny classnames joiner — filters out falsy values and joins with a space. */
export const cn = (...a: Array<string | false | null | undefined>) =>
  a.filter(Boolean).join(" ");
