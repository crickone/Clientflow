import "server-only";

import { getPlatformSetting, setPlatformSetting } from "@/lib/billing/settings";

/** A saved console view: a name and the URL (path + query) that reproduces it. Per staff member. */
export interface ConsoleView { id: string; name: string; href: string }

const MAX = 30;
const FULL_ERROR = "You have 30 saved views. Remove one first.";

/**
 * True only for a same-origin console path: starts with a single slash (not `//` or `/\`),
 * has no control characters, and is at most 500 characters. Anything else would render
 * as an external sidebar link.
 */
export function isSafeConsolePath(href: string): boolean {
  return href.length <= 500 && /^\/(?![\/\\])/.test(href) && !/[\u0000-\u001f\u007f]/.test(href);
}

export function listViews(userId: number): ConsoleView[] {
  try {
    const raw = getPlatformSetting(`console_views:${userId}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is ConsoleView => typeof v?.id === "string" && typeof v?.name === "string" && typeof v?.href === "string" && isSafeConsolePath(v.href));
  } catch {
    return [];
  }
}

export function saveViews(userId: number, views: ConsoleView[]): { ok: true } | { ok: false; error: string } {
  if (views.length > MAX) return { ok: false, error: FULL_ERROR };
  const seen = new Set<string>();
  const clean: ConsoleView[] = [];
  for (const v of views) {
    if (!isSafeConsolePath(v.href) || !v.name.trim() || seen.has(v.href)) continue;
    seen.add(v.href);
    clean.push({ id: v.id.slice(0, 40), name: v.name.trim().slice(0, 60), href: v.href });
  }
  setPlatformSetting(`console_views:${userId}`, JSON.stringify(clean));
  return { ok: true };
}
