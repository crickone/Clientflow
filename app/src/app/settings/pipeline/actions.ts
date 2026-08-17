"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentMembership, requireAdmin } from "@/lib/auth";
import {
  createStage,
  deleteStageWithMove,
  listStages,
  reorderStages,
  updateStage,
} from "@/lib/pipeline/stageRepo";
import { ALL_ROLES, canDeleteStage, roleConflict, type StageRole } from "@/lib/pipeline/roles";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * The acting admin's active tenant. requireAdmin already throws unless the caller
 * is an admin in the active tenant. Every stageRepo call below runs against the
 * ambient request-scoped `db` (see stageRepo.ts) which is already scoped to THIS
 * tenant — there's no tenantId to thread through the repo calls — but resolving
 * (and discarding) it here proves the guard ran and mirrors this file's sibling
 * convention (api-keys/actions.ts's adminTenantId()): admin-only, tenant-scoped,
 * never a client-supplied tenant id.
 */
async function adminTenantId(): Promise<number> {
  await requireAdmin();
  const current = getCurrentMembership();
  if (!current) throw new Error("UNAUTHENTICATED");
  return current.tenant.id;
}

function revalidate() {
  revalidatePath("/settings/pipeline");
  revalidatePath("/leads");
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const nameField = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(60, "Keep the name under 60 characters");
const colourField = z.string().regex(HEX_RE, "Pick a colour");

const ALL_ROLES_SET = new Set<string>(ALL_ROLES);

function isValidRole(role: unknown): role is StageRole | null {
  return role === null || (typeof role === "string" && ALL_ROLES_SET.has(role));
}

/**
 * Add a stage to the active tenant's pipeline. Rejects a role already held by
 * another stage — a role may be assigned to at most one stage at a time.
 */
export async function addStageAction(input: {
  name: string;
  colour: string;
  role: StageRole | null;
}): Promise<ActionResult> {
  await adminTenantId();

  const name = nameField.safeParse(input?.name);
  if (!name.success) {
    return { ok: false, error: name.error.issues[0]?.message ?? "Invalid name" };
  }
  const colour = colourField.safeParse(input?.colour);
  if (!colour.success) {
    return { ok: false, error: colour.error.issues[0]?.message ?? "Invalid colour" };
  }
  if (!isValidRole(input?.role)) {
    return { ok: false, error: "Invalid role" };
  }

  const role = input.role;
  if (role) {
    const conflict = roleConflict(listStages(), role, null);
    if (conflict) {
      return { ok: false, error: `That role is already used by "${conflict.name}".` };
    }
  }

  createStage({ name: name.data, colour: colour.data, role });
  revalidate();
  return { ok: true };
}

/**
 * Rename / recolour / retag a stage. Only the fields present in `patch` are
 * touched. Rejects a role change onto a role another stage already holds.
 */
export async function updateStageAction(
  id: number,
  patch: { name?: string; colour?: string; role?: StageRole | null },
): Promise<ActionResult> {
  await adminTenantId();
  if (!Number.isInteger(id)) return { ok: false, error: "Invalid stage" };

  const stages = listStages();
  if (!stages.some((s) => s.id === id)) return { ok: false, error: "Stage not found." };

  const next: { name?: string; colour?: string; role?: StageRole | null } = {};

  if (patch.name !== undefined) {
    const name = nameField.safeParse(patch.name);
    if (!name.success) {
      return { ok: false, error: name.error.issues[0]?.message ?? "Invalid name" };
    }
    next.name = name.data;
  }

  if (patch.colour !== undefined) {
    const colour = colourField.safeParse(patch.colour);
    if (!colour.success) {
      return { ok: false, error: colour.error.issues[0]?.message ?? "Invalid colour" };
    }
    next.colour = colour.data;
  }

  if (patch.role !== undefined) {
    if (!isValidRole(patch.role)) return { ok: false, error: "Invalid role" };
    if (patch.role) {
      const conflict = roleConflict(listStages(), patch.role, id);
      if (conflict) {
        return { ok: false, error: `That role is already used by "${conflict.name}".` };
      }
    }
    next.role = patch.role;
  }

  if (Object.keys(next).length === 0) {
    return { ok: false, error: "Nothing to update." };
  }

  updateStage(id, next);
  revalidate();
  return { ok: true };
}

/**
 * Persist a new stage order (drag-and-drop). `orderedIds` must be exactly the
 * active tenant's current stage ids (any order) — a stale/partial list is
 * rejected rather than silently corrupting positions.
 */
export async function reorderStagesAction(orderedIds: number[]): Promise<ActionResult> {
  await adminTenantId();
  if (!Array.isArray(orderedIds) || orderedIds.length === 0 || orderedIds.some((n) => !Number.isInteger(n))) {
    return { ok: false, error: "Invalid order" };
  }

  const currentIds = new Set(listStages().map((s) => s.id));
  const sameSet = orderedIds.length === currentIds.size && orderedIds.every((id) => currentIds.has(id)) && new Set(orderedIds).size === orderedIds.length;
  if (!sameSet) {
    return { ok: false, error: "Stage list is out of date — refresh and try again." };
  }

  reorderStages(orderedIds);
  revalidate();
  return { ok: true };
}

/**
 * Delete a stage, moving its leads to `moveToId` first. Rejects deleting the
 * last remaining stage (a pipeline always needs at least one).
 */
export async function deleteStageAction(id: number, moveToId: number): Promise<ActionResult> {
  await adminTenantId();
  if (!Number.isInteger(id) || !Number.isInteger(moveToId)) {
    return { ok: false, error: "Invalid stage" };
  }
  if (id === moveToId) {
    return { ok: false, error: "Choose a different stage to move its leads to." };
  }

  const stages = listStages();
  if (!stages.some((s) => s.id === id)) return { ok: false, error: "Stage not found." };
  const gate = canDeleteStage(stages, id);
  if (!gate.ok) {
    return { ok: false, error: gate.reason };
  }
  if (!stages.some((s) => s.id === moveToId)) {
    return { ok: false, error: "Pick a stage to move its leads to." };
  }

  deleteStageWithMove(id, moveToId);
  revalidate();
  return { ok: true };
}
