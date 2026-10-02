"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, requireUser } from "@/lib/auth";
import { CATALOG_BY_KEY, MAX_WIDGETS_PER_TAB, validateLayout } from "@/lib/dashboard/catalog";
import * as tabs from "@/lib/dashboard/tabs";
import type { Venue } from "@/lib/dashboard/types";
import { isRefVisible, mergeHiddenRefs } from "@/lib/dashboard/visibility";
import { getVisibilityOverrides, setSensitivityVisibility, setWidgetVisibility } from "@/lib/dashboard/visibilityStore";
import { getSchedulingMode } from "@/lib/settings";

export type ActionResult = { ok: true; index?: number } | { ok: false; error: string };

type Who = { userId: number; venue: Venue; isAdmin: boolean; role: "admin" | "staff" };

const AUTH_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Please sign in again.",
  TENANT_SUSPENDED: "This account is suspended. Please check billing.",
  FORBIDDEN: "Only admins can do that.",
};

/** requireUser/requireAdmin enforce the billing gate; role comes from the membership. */
async function who(admin = false): Promise<Who> {
  const user = admin ? await requireAdmin() : await requireUser();
  return {
    userId: user.id,
    venue: getSchedulingMode() === "timetable" ? "gym" : "clinic",
    isAdmin: user.role === "admin",
    role: user.role === "admin" ? "admin" : "staff",
  };
}

async function run(fn: () => Promise<number | void> | number | void, path = "/dashboard"): Promise<ActionResult> {
  try {
    const index = await fn();
    revalidatePath(path);
    return typeof index === "number" ? { ok: true, index } : { ok: true };
  } catch (e) {
    // Next's redirect()/notFound() signal by throwing; never swallow them.
    const digest = (e as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND"))) throw e;
    const msg = e instanceof Error ? e.message : "";
    return { ok: false, error: AUTH_MESSAGES[msg] ?? (msg || "Something went wrong.") };
  }
}

const int = (n: unknown) => (Number.isInteger(n) ? (n as number) : -1);

export async function saveWidgetsAction(index: number, widgets: unknown): Promise<ActionResult> {
  return run(async () => {
    const u = await who();
    const i = int(index);
    const submitted = validateLayout(widgets);
    // Widgets this viewer cannot see were never sent; keep them in the saved tab.
    const stored = tabs.resolveTabs(u.userId, u.venue).tabs[i]?.widgets ?? [];
    const opts = { venue: u.venue, role: u.role, overrides: getVisibilityOverrides() };
    const merged = mergeHiddenRefs(stored, submitted, (ref) => isRefVisible(ref, opts));
    if (merged.length > MAX_WIDGETS_PER_TAB) {
      throw new Error(`A tab can hold at most ${MAX_WIDGETS_PER_TAB} widgets.`);
    }
    tabs.saveTabWidgets(u.userId, u.venue, i, merged);
  });
}

export async function setRangeAction(index: number, range: string): Promise<ActionResult> {
  return run(async () => {
    const u = await who();
    tabs.setTabRange(u.userId, u.venue, int(index), String(range));
  });
}

export async function addTabAction(
  input: { kind: "preset"; presetKey: string } | { kind: "blank" } | { kind: "duplicate"; index: number },
): Promise<ActionResult> {
  return run(async () => {
    const u = await who();
    if (input?.kind === "preset") return tabs.addTab(u.userId, u.venue, { kind: "preset", presetKey: String(input.presetKey) });
    if (input?.kind === "duplicate") return tabs.addTab(u.userId, u.venue, { kind: "duplicate", index: int(input.index) });
    return tabs.addTab(u.userId, u.venue, { kind: "blank" });
  });
}

export async function renameTabAction(index: number, name: string): Promise<ActionResult> {
  return run(async () => {
    const u = await who();
    tabs.renameTab(u.userId, u.venue, int(index), String(name ?? ""));
  });
}

export async function deleteTabAction(index: number): Promise<ActionResult> {
  return run(async () => {
    const u = await who();
    tabs.deleteTab(u.userId, u.venue, int(index));
  });
}

export async function moveTabAction(from: number, to: number): Promise<ActionResult> {
  return run(async () => {
    const u = await who();
    tabs.moveTab(u.userId, u.venue, int(from), int(to));
  });
}

export async function resetTabAction(index: number): Promise<ActionResult> {
  return run(async () => {
    const u = await who();
    tabs.resetTab(u.userId, u.venue, int(index));
  });
}

export async function makeTeamDefaultAction(): Promise<ActionResult> {
  return run(async () => {
    const u = await who(true);
    tabs.makeTeamDefault(u.userId, u.venue);
  });
}

export async function clearTeamDefaultAction(): Promise<ActionResult> {
  return run(async () => {
    const u = await who(true);
    tabs.clearTeamDefault();
  });
}

export async function setWidgetVisibilityAction(key: string, visible: boolean | null): Promise<ActionResult> {
  return run(async () => {
    const u = await who(true);
    if (!CATALOG_BY_KEY.has(key)) throw new Error("Unknown widget.");
    if (visible !== null && typeof visible !== "boolean") throw new Error("Invalid value.");
    setWidgetVisibility(key, visible);
  }, "/settings/dashboard");
}

export async function setFinancialVisibilityAction(visible: boolean): Promise<ActionResult> {
  return run(async () => {
    const u = await who(true);
    if (typeof visible !== "boolean") throw new Error("Invalid value.");
    setSensitivityVisibility(["financial", "spend"], visible);
  }, "/settings/dashboard");
}
