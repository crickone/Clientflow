"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pin, PinOff, Trash2 } from "lucide-react";

import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { addNoteAction, deleteNoteAction, pinNoteAction } from "@/app/(console)/gyms/[id]/business-actions";
import type { Note } from "@/lib/types";

export function Notes({ tenantId, notes, meId, isOwner }: { tenantId: number; notes: Note[]; meId: number; isOwner: boolean }) {
  const router = useRouter();
  const ask = useConfirm();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const after = (r: { ok: boolean; error?: string }, okMsg: string) => { if (r.ok) { notify.ok(okMsg); router.refresh(); } else notify.fail(r.error ?? "That did not work."); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <form
        onSubmit={(e) => { e.preventDefault(); if (!body.trim()) return; start(async () => { after(await addNoteAction(tenantId, body), "Note added"); setBody(""); }); }}
        style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
      >
        <textarea className="input" rows={2} placeholder="Leave a note for the team…" value={body} onChange={(e) => setBody(e.target.value)} style={{ resize: "vertical" }} />
        <button className="btn btn--primary btn--md" type="submit" disabled={pending || !body.trim()}>Add</button>
      </form>
      {notes.length === 0 && <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)" }}>No notes yet.</p>}
      <ul className="notes">
        {notes.map((n) => (
          <li key={n.id} className={n.pinned ? "is-pinned" : undefined}>
            <div className="note-body">{n.body}</div>
            <div className="note-meta">
              <span>{n.authorEmail}, {new Date(n.createdAt).toLocaleDateString("en-IE")}</span>
              <span className="note-actions">
                <button type="button" className="btn btn--ghost btn--icon" aria-label={n.pinned ? "Unpin" : "Pin"} onClick={() => start(async () => after(await pinNoteAction(tenantId, n.id, !n.pinned), n.pinned ? "Unpinned" : "Pinned"))}>{n.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
                {(n.authorUserId === meId || isOwner) && (
                  <button type="button" className="btn btn--ghost btn--icon" aria-label="Delete" onClick={async () => { const r = await ask({ title: "Remove this note?", confirmLabel: "Remove", danger: true }); if (r.ok) start(async () => after(await deleteNoteAction(tenantId, n.id), "Note removed")); }}><Trash2 size={13} /></button>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
