// Run: npm test -- src/lib/platform/tasks.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { addTask, listTasks, setTaskDone, deleteTask, dueBuckets } = requireLocal("./tasks") as typeof import("./tasks");

  const day = 86400000;
  const now = Date.UTC(2026, 10, 11, 12);
  const mk = (title: string, dueAt: number | null) => ({ id: 0, tenantId: null, tenantName: null, title, dueAt, assignedTo: null, doneAt: null, createdBy: 1, createdAt: 0 });
  const b = dueBuckets([mk("late", now - day), mk("today", now + 3600000), mk("soon", now + 3 * day), mk("none", null)], now);
  assert.deepEqual(b.overdue.map((t) => t.title), ["late"]);
  assert.deepEqual(b.today.map((t) => t.title), ["today"]);
  assert.deepEqual(b.later.map((t) => t.title), ["soon"]);
  assert.deepEqual(b.undated.map((t) => t.title), ["none"]);

  const email = "tasks-test-user@example.invalid";
  controlSqlite.prepare("DELETE FROM platform_tasks WHERE title LIKE 'tasktest %'").run();
  controlSqlite.prepare("DELETE FROM users WHERE email = ?").run(email);
  const u = controlSqlite.prepare("INSERT INTO users (email, password_hash) VALUES (?, 'x') RETURNING id").get(email) as { id: number };
  const cleanup = () => controlSqlite.prepare("DELETE FROM platform_tasks WHERE title LIKE 'tasktest %'").run();
  try {
    const t1 = addTask({ tenantId: null, title: "tasktest a", dueAt: now + day, assignedTo: u.id, createdBy: u.id });
    const t2 = addTask({ tenantId: null, title: "tasktest b", dueAt: null, assignedTo: null, createdBy: u.id });
    assert.equal(listTasks({ open: true }).filter((t) => t.title.startsWith("tasktest")).length, 2);
    assert.equal(listTasks({ assignedTo: u.id, open: true }).filter((t) => t.title.startsWith("tasktest")).length, 1);
    setTaskDone(t1.id, true);
    assert.equal(listTasks({ open: true }).filter((t) => t.title.startsWith("tasktest")).length, 1);
    assert.ok(listTasks({}).find((t) => t.id === t1.id)?.doneAt);
    deleteTask(t2.id);
    assert.equal(listTasks({}).filter((t) => t.title.startsWith("tasktest")).length, 1);
    console.log("tasks.test.ts: ok");
  } finally {
    cleanup();
    controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(u.id);
  }
})().catch((e) => { console.error(e); process.exit(1); });
