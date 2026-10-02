"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMembership } from "@/lib/auth";
import { CATALOG_BY_KEY } from "@/lib/dashboard/catalog";
import * as tabs from "@/lib/dashboard/tabs";
import type { Venue } from "@/lib/dashboard/types";
import { setSensitivityVisibility, setWidgetVisibility } from "@/lib/dashboard/visibilityStore";
import { getSchedulingMode } from "@/lib/settings";

export type ActionResult = { ok: true; index?: number } | { ok: false; error: string };

function who(): { userId: number; venue: Venue; isAdmin: boolean } {
  const m = getCurrentMembership();
  if (!m) throw new Error("Please sign in again.");
  return {
    userId: m.user.id,
    venue: getSchedulingMode() === "timetable" ? "gym" : "clinic",
    isAdmin: m.role === "admin",
  };
}

function run(fn: () => number | void, path = "/dashboard"): ActionResult {
  try {
    const index = fn();
    revalidatePath(path);
    return typeof index === "number" ? { ok: true, index } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

const int = (n: unknown) => (Number.isInteger(n) ? (n as number) : -1);

export async function saveWidgetsAction(index: number, widgets: unknown): Promise<ActionResult> {
  return run(() => {
    const u = who();
    tabs.saveTabWidgets(u.userId, u.venue, int(index), widgets);
  });
}

export async function setRangeAction(index: number, range: string): Promise<ActionResult> {
  return run(() => {
    const u = who();
    tabs.setTabRange(u.userId, u.venue, int(index), String(range));
  });
}

export async function addTabAction(
  input: { kind: "preset"; presetKey: string } | { kind: "blank" } | { kind: "duplicate"; index: number },
): Promise<ActionResult> {
  return run(() => {
    const u = who();
    if (input?.kind === "preset") return tabs.addTab(u.userId, u.venue, { kind: "preset", presetKey: String(input.presetKey) });
    if (input?.kind === "duplicate") return tabs.addTab(u.userId, u.venue, { kind: "duplicate", index: int(input.index) });
    return tabs.addTab(u.userId, u.venue, { kind: "blank" });
  });
}

export async function renameTabAction(index: number, name: string): Promise<ActionResult> {
  return run(() => {
    const u = who();
    tabs.renameTab(u.userId, u.venue, int(index), String(name ?? ""));
  });
}

export async function deleteTabAction(index: number): Promise<ActionResult> {
  return run(() => {
    const u = who();
    tabs.deleteTab(u.userId, u.venue, int(index));
  });
}

export async function moveTabAction(from: number, to: number): Promise<ActionResult> {
  return run(() => {
    const u = who();
    tabs.moveTab(u.userId, u.venue, int(from), int(to));
  });
}

export async function resetTabAction(index: number): Promise<ActionResult> {
  return run(() => {
    const u = who();
    tabs.resetTab(u.userId, u.venue, int(index));
  });
}

export async function makeTeamDefaultAction(): Promise<ActionResult> {
  return run(() => {
    const u = who();
    if (!u.isAdmin) throw new Error("Only admins can set the team default.");
    tabs.makeTeamDefault(u.userId, u.venue);
  });
}

export async function clearTeamDefaultAction(): Promise<ActionResult> {
  return run(() => {
    const u = who();
    if (!u.isAdmin) throw new Error("Only admins can change the team default.");
    tabs.clearTeamDefault();
  });
}

export async function setWidgetVisibilityAction(key: string, visible: boolean | null): Promise<ActionResult> {
  return run(() => {
    const u = who();
    if (!u.isAdmin) throw new Error("Only admins can change widget visibility.");
    if (!CATALOG_BY_KEY.has(key)) throw new Error("Unknown widget.");
    setWidgetVisibility(key, visible === null ? null : !!visible);
  }, "/settings/dashboard");
}

export async function setFinancialVisibilityAction(visible: boolean): Promise<ActionResult> {
  return run(() => {
    const u = who();
    if (!u.isAdmin) throw new Error("Only admins can change widget visibility.");
    setSensitivityVisibility(["financial", "spend"], !!visible);
  }, "/settings/dashboard");
}
