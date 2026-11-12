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

  // Dublin boundaries: in November (GMT) midnight is 00:00Z; in summer (IST) it is 23:00Z the day before.
  const winter = Date.UTC(2026, 10, 11, 23, 30); // 23:30 Dublin, 11 Nov
  const w = dueBuckets([mk("a", Date.UTC(2026, 10, 11, 0, 5)), mk("b", Date.UTC(2026, 10, 12, 0, 5)), mk("c", Date.UTC(2026, 10, 10, 23, 59))], winter);
  assert.deepEqual(w.today.map((t) => t.title), ["a"]);
  assert.deepEqual(w.later.map((t) => t.title), ["b"]);
  assert.deepEqual(w.overdue.map((t) => t.title), ["c"]);
  const summer = Date.UTC(2026, 6, 1, 22, 30); // 23:30 Dublin on 1 Jul, still 1 Jul locally
  const s = dueBuckets([mk("x", Date.UTC(2026, 6, 1, 22, 45)), mk("y", Date.UTC(2026, 6, 1, 23, 5)), mk("z", Date.UTC(2026, 5, 30, 22, 59))], summer);
  assert.deepEqual(s.today.map((t) => t.title), ["x"]);
  assert.deepEqual(s.later.map((t) => t.title), ["y"], "23:05Z is 00:05 Dublin the next day");
  assert.deepEqual(s.overdue.map((t) => t.title), ["z"]);

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
