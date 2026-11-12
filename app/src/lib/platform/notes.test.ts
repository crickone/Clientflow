// Run: npm test -- src/lib/platform/notes.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { addNote, listNotes, deleteNote } = requireLocal("./notes") as typeof import("./notes");

  const slug = "notes-test";
  const emails = ["notes-test-author@example.invalid", "notes-test-other@example.invalid", "notes-test-owner@example.invalid"];
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  for (const e of emails) controlSqlite.prepare("DELETE FROM users WHERE email = ?").run(e);
  const t = controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, 'Notes Test', ?, 1) RETURNING id").get(slug, `tenants/${slug}/void.db`) as { id: number };
  const [author, other, owner] = emails.map((e) => (controlSqlite.prepare("INSERT INTO users (email, password_hash) VALUES (?, 'x') RETURNING id").get(e) as { id: number }).id);
  try {
    const n1 = addNote(t.id, author, "notetest one");
    assert.equal(n1.authorEmail, emails[0]);
    const denied = deleteNote(n1.id, other, false);
    assert.equal(denied.ok, false, "another staff member cannot delete");
    assert.equal(listNotes(t.id).length, 1);
    assert.deepEqual(deleteNote(n1.id, author, false), { ok: true });
    assert.equal(listNotes(t.id).length, 0, "the author can delete");

    const n2 = addNote(t.id, author, "notetest two");
    assert.deepEqual(deleteNote(n2.id, owner, true), { ok: true });
    assert.equal(listNotes(t.id).length, 0, "an owner can delete anyone's note");

    assert.equal(deleteNote(n2.id, owner, true).ok, false, "a missing note is reported");
    console.log("notes.test.ts: ok");
  } finally {
    controlSqlite.prepare("DELETE FROM tenant_notes WHERE tenant_id = ?").run(t.id);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    for (const e of emails) controlSqlite.prepare("DELETE FROM users WHERE email = ?").run(e);
  }
})().catch((e) => { console.error(e); process.exit(1); });
