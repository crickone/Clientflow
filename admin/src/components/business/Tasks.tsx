"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { notify } from "@/lib/toast";
import { addTaskAction, deleteTaskAction, setTaskDoneAction } from "@/app/(console)/gyms/[id]/business-actions";
import type { PlatformStaffRow, Task } from "@/lib/types";

export function Tasks({ tenantId, tasks, staff, meId }: { tenantId: number; tasks: Task[]; staff: PlatformStaffRow[]; meId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [who, setWho] = useState(staff.some((s) => s.userId === meId) ? String(meId) : "");
  const after = (r: { ok: boolean; error?: string }, okMsg: string) => { if (r.ok) { notify.ok(okMsg); router.refresh(); } else notify.fail(r.error ?? "That did not work."); };
  const open = tasks.filter((t) => !t.doneAt);
  const doneList = tasks.filter((t) => t.doneAt).slice(0, 5);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          start(async () => {
            const r = await addTaskAction(tenantId, { title, dueAt: due ? Date.parse(due) + 9 * 3600000 : null, assignedTo: who ? Number(who) : null });
            after(r, "Task added");
            if (r.ok) { setTitle(""); setDue(""); }
          });
        }}
      >
        <input className="input toolbar-search" placeholder="What needs doing?" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due" />
        <select className="input" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Assign to">
          <option value="">Unassigned</option>
          {staff.map((s) => <option key={s.userId} value={s.userId}>{s.userId === meId ? "Me" : s.name ?? s.email}</option>)}
        </select>
        <button className="btn btn--primary btn--md" type="submit" disabled={pending || !title.trim()}>Add</button>
      </form>
      {open.length === 0 && <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)" }}>Nothing open.</p>}
      <ul className="tasks">
        {[...open, ...doneList].map((t) => {
          const overdue = t.dueAt !== null && !t.doneAt && t.dueAt < Date.now();
          const assignee = staff.find((s) => s.userId === t.assignedTo);
          return (
            <li key={t.id} className={t.doneAt ? "is-done" : undefined}>
              <input type="checkbox" checked={Boolean(t.doneAt)} aria-label="Done" onChange={() => start(async () => after(await setTaskDoneAction(tenantId, t.id, !t.doneAt), t.doneAt ? "Reopened" : "Done"))} />
              <span className="task-title">{t.title}</span>
              <span className="task-meta" style={overdue ? { color: "var(--red)" } : undefined}>
                {t.dueAt ? new Date(t.dueAt).toLocaleDateString("en-IE") : ""}{assignee ? ` · ${assignee.name ?? assignee.email}` : ""}
              </span>
              <button type="button" className="btn btn--ghost btn--icon" aria-label="Delete" onClick={() => start(async () => after(await deleteTaskAction(tenantId, t.id), "Task removed"))}><Trash2 size={13} /></button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
