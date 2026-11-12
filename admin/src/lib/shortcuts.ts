/**
 * Two-key chords, the way Linear and GitHub do it: press g, then a letter.
 * Pure, so the list and the help dialog are one source of truth.
 */
export const SHORTCUTS = [
  { keys: "g d", label: "Dashboard", href: "/" },
  { keys: "g b", label: "Businesses", href: "/gyms" },
  { keys: "g h", label: "Health", href: "/health" },
  { keys: "g i", label: "Inbox", href: "/inbox" },
  { keys: "g j", label: "Jobs", href: "/jobs" },
  { keys: "g f", label: "Feature flags", href: "/flags" },
  { keys: "g p", label: "Provision a business", href: "/provision" },
  { keys: "g a", label: "Audit log", href: "/audit" },
  { keys: "g s", label: "Settings", href: "/settings" },
  { keys: "/", label: "Search" },
  { keys: "?", label: "Show these shortcuts" },
] as const;

export type Resolution =
  | { kind: "go"; href: string }
  | { kind: "help" }
  | { kind: "search" }
  | { kind: "pending"; key: string }
  | { kind: "none" };

export function resolveShortcut(prev: string | null, key: string): Resolution {
  if (prev === null) {
    if (key === "?") return { kind: "help" };
    if (key === "/") return { kind: "search" };
    if (key === "g") return { kind: "pending", key };
    return { kind: "none" };
  }
  const hit = SHORTCUTS.find((s) => s.keys === `${prev} ${key}`);
  return hit && "href" in hit ? { kind: "go", href: hit.href } : { kind: "none" };
}
