import "server-only";

import { controlSqlite } from "@/lib/db/control";

/** Free-text notes platform staff leave on a business. Pinned ones stay on top. */
export interface Note {
  id: number;
  tenantId: number;
  authorUserId: number;
  authorEmail: string;
  body: string;
  pinned: boolean;
  createdAt: number;
}

type Raw = { id: number; tenant_id: number; author_user_id: number; author_email: string; body: string; pinned: number; created_at: number };
const toNote = (r: Raw): Note => ({ id: r.id, tenantId: r.tenant_id, authorUserId: r.author_user_id, authorEmail: r.author_email, body: r.body, pinned: r.pinned === 1, createdAt: r.created_at });
const SELECT = "SELECT n.*, u.email AS author_email FROM tenant_notes n JOIN users u ON u.id = n.author_user_id";

export function listNotes(tenantId: number): Note[] {
  return (controlSqlite.prepare(`${SELECT} WHERE n.tenant_id = ? ORDER BY n.pinned DESC, n.created_at DESC`).all(tenantId) as Raw[]).map(toNote);
}

export function addNote(tenantId: number, authorUserId: number, body: string): Note {
  const id = Number(controlSqlite.prepare("INSERT INTO tenant_notes (tenant_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?)").run(tenantId, authorUserId, body.trim().slice(0, 4000), Date.now()).lastInsertRowid);
  return toNote(controlSqlite.prepare(`${SELECT} WHERE n.id = ?`).get(id) as Raw);
}

export function setNotePinned(id: number, pinned: boolean): void {
  controlSqlite.prepare("UPDATE tenant_notes SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, id);
}

/** Your own note, or any note if you are an owner. */
export function deleteNote(id: number, byUserId: number, isOwner: boolean): { ok: true } | { ok: false; error: string } {
  const row = controlSqlite.prepare("SELECT author_user_id FROM tenant_notes WHERE id = ?").get(id) as { author_user_id: number } | undefined;
  if (!row) return { ok: false, error: "That note is gone." };
  if (row.author_user_id !== byUserId && !isOwner) return { ok: false, error: "Only the author or an owner can remove a note." };
  controlSqlite.prepare("DELETE FROM tenant_notes WHERE id = ?").run(id);
  return { ok: true };
}
