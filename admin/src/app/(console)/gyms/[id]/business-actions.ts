"use server";

import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";
import { bust } from "@/lib/revalidate";
import type { Note, Stage, Task } from "@/lib/types";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function fail(err: unknown, fallback: string): { ok: false; error: string } {
  return { ok: false, error: err instanceof ApiError ? err.message : fallback };
}
function done(tenantId: number) {
  bust(tenantId);
  revalidatePath(`/gyms/${tenantId}`);
  revalidatePath("/gyms");
}

export async function setMetaAction(tenantId: number, patch: { stage?: Stage | null; ownerUserId?: number | null; tags?: string[] }): Promise<Result> {
  try { await api(`/tenants/${tenantId}/meta`, { method: "PUT", body: patch }); done(tenantId); return { ok: true }; }
  catch (err) { return fail(err, "Could not save that."); }
}

export async function addNoteAction(tenantId: number, body: string): Promise<Result<Note>> {
  try { const r = await api<{ note: Note }>(`/tenants/${tenantId}/notes`, { method: "POST", body: { body } }); done(tenantId); return { ok: true, data: r.note }; }
  catch (err) { return fail(err, "Could not add the note."); }
}

export async function pinNoteAction(tenantId: number, id: number, pinned: boolean): Promise<Result> {
  try { await api(`/tenants/${tenantId}/notes`, { method: "PATCH", body: { id, pinned } }); done(tenantId); return { ok: true }; }
  catch (err) { return fail(err, "Could not pin that."); }
}

export async function deleteNoteAction(tenantId: number, id: number): Promise<Result> {
  try { await api(`/tenants/${tenantId}/notes?id=${id}`, { method: "DELETE" }); done(tenantId); return { ok: true }; }
  catch (err) { return fail(err, "Could not remove that note."); }
}

export async function addTaskAction(tenantId: number, input: { title: string; dueAt: number | null; assignedTo: number | null }): Promise<Result<Task>> {
  try { const r = await api<{ task: Task }>(`/tenants/${tenantId}/tasks`, { method: "POST", body: input }); done(tenantId); revalidatePath("/inbox"); return { ok: true, data: r.task }; }
  catch (err) { return fail(err, "Could not add the task."); }
}

export async function setTaskDoneAction(tenantId: number | null, id: number, isDone: boolean): Promise<Result> {
  try { await api(`/tenants/${tenantId ?? 0}/tasks`, { method: "PATCH", body: { id, done: isDone } }); if (tenantId) done(tenantId); revalidatePath("/inbox"); return { ok: true }; }
  catch (err) { return fail(err, "Could not update the task."); }
}

export async function deleteTaskAction(tenantId: number | null, id: number): Promise<Result> {
  try { await api(`/tenants/${tenantId ?? 0}/tasks?id=${id}`, { method: "DELETE" }); if (tenantId) done(tenantId); revalidatePath("/inbox"); return { ok: true }; }
  catch (err) { return fail(err, "Could not remove the task."); }
}
