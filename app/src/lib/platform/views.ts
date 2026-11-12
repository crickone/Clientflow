import "server-only";

import { getPlatformSetting, setPlatformSetting } from "@/lib/billing/settings";

/** A saved console view: a name and the URL (path + query) that reproduces it. Per staff member. */
export interface ConsoleView { id: string; name: string; href: string }

const MAX = 30;

export function listViews(userId: number): ConsoleView[] {
  try {
    const raw = getPlatformSetting(`console_views:${userId}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is ConsoleView => typeof v?.id === "string" && typeof v?.name === "string" && typeof v?.href === "string" && v.href.startsWith("/"));
  } catch {
    return [];
  }
}

export function saveViews(userId: number, views: ConsoleView[]): void {
  const clean = views
    .filter((v) => v.href.startsWith("/") && v.name.trim())
    .map((v) => ({ id: v.id.slice(0, 40), name: v.name.trim().slice(0, 60), href: v.href.slice(0, 500) }))
    .slice(0, MAX);
  setPlatformSetting(`console_views:${userId}`, JSON.stringify(clean));
}
