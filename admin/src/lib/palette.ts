import type { SearchHit } from "@/lib/types";

export interface StaticCommand { title: string; hint: string; href: string }

export const STATIC_COMMANDS: StaticCommand[] = [
  { title: "Dashboard", hint: "g d", href: "/" },
  { title: "Businesses", hint: "g b", href: "/gyms" },
  { title: "Inbox", hint: "g i", href: "/inbox" },
  { title: "Jobs", hint: "g j", href: "/jobs" },
  { title: "Health", hint: "g h", href: "/health" },
  { title: "Provision a business", hint: "g p", href: "/provision" },
  { title: "Audit log", hint: "g a", href: "/audit" },
  { title: "Platform staff", hint: "", href: "/staff" },
  { title: "Settings", hint: "g s", href: "/settings" },
];

/** Empty query: everything in order. Otherwise: prefix matches first, then substring matches. */
export function rankStatic(q: string, commands: StaticCommand[]): StaticCommand[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return commands;
  const starts = commands.filter((c) => c.title.toLowerCase().startsWith(needle));
  const contains = commands.filter((c) => !starts.includes(c) && c.title.toLowerCase().includes(needle));
  return [...starts, ...contains];
}

/** Recent hits, newest first, no duplicates by href, capped. */
export function pushRecent(list: SearchHit[], hit: SearchHit, max: number): SearchHit[] {
  return [hit, ...list.filter((h) => h.href !== hit.href)].slice(0, max);
}
