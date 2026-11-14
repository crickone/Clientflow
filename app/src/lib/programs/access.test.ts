// app/src/lib/programs/access.test.ts
// Run: npm test -- src/lib/programs/access.test.ts
//
// The Programs tab shows only to DIY members of a business where the module
// is on: platform rollout (default nobody) and the business's own switch.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("redirect");
      },
    };
  }
  if (request === "next/headers") {
    return {
      cookies: () => {
        throw new Error("no request");
      },
      headers: () => new Map(),
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { setFeatureFlags } = requireLocal("../settings") as typeof import("../settings");
  const { setPlatformFlag } = requireLocal("../platform/flags") as typeof import("../platform/flags");
  const { memberSeesPrograms, programsOn } = requireLocal("./access") as typeof import("./access");

  const slug = "programs-access-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (
    controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id").get(slug, "Programs Access Test", dbFile) as { id: number }
  ).id;
  const saved = controlSqlite.prepare("SELECT key, mode, percent, allow, updated_at FROM platform_flags WHERE key = 'programs'").get() as
    | { key: string; mode: string; percent: number; allow: string; updated_at: number }
    | undefined;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM platform_flags WHERE key = 'programs'").run();
    if (saved) controlSqlite.prepare("INSERT INTO platform_flags (key, mode, percent, allow, updated_at) VALUES (?,?,?,?,?)").run(saved.key, saved.mode, saved.percent, saved.allow, saved.updated_at);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  type Member = Parameters<typeof memberSeesPrograms>[0];
  const member = (mode: "coach" | "diy") => ({ tenantId: tid, clientId: 0, client: { trainingMode: mode } }) as unknown as Member;

  try {
    controlSqlite.prepare("DELETE FROM platform_flags WHERE key = 'programs'").run();
    assert.equal(programsOn(tid), false, "nobody by default");
    assert.equal(memberSeesPrograms(member("diy")), false);

    setPlatformFlag({ key: "programs", mode: "allow", percent: 100, allow: [tid] });
    assert.equal(programsOn(tid), true, "a named business has it");
    assert.equal(memberSeesPrograms(member("diy")), true);
    runWithTenant(tid, () => assert.equal(memberSeesPrograms(member("coach")), false, "coach guided members without a coach-set program never see the tab"));
    assert.equal(memberSeesPrograms(null), false);

    // A coach-guided member sees Programs while their live program is coach-set.
    const { db } = requireLocal("../db") as typeof import("../db");
    const schema = requireLocal("../db/schema") as typeof import("../db/schema");
    const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
    runWithTenant(tid, () => {
      const cid = db.insert(schema.clients).values({ firstName: "Access", lastName: "Test", phone: "0000000" } as never).returning({ id: schema.clients.id }).get().id;
      const now = Date.now();
      const base = { clientId: cid, templateJson: "{}", startDate: "2026-01-01", createdAt: now, updatedAt: now } as const;
      const withId = (): Member => ({ tenantId: tid, clientId: cid, client: { trainingMode: "coach" } }) as unknown as Member;
      assert.equal(memberSeesPrograms(withId()), false, "no enrolment");
      const own = db.insert(schema.programEnrolments).values({ ...base, status: "paused" }).returning({ id: schema.programEnrolments.id }).get().id;
      assert.equal(memberSeesPrograms(withId()), false, "member-chosen paused program does not count");
      db.update(schema.programEnrolments).set({ status: "ended" }).where(eq(schema.programEnrolments.id, own)).run();
      db.insert(schema.programEnrolments).values({ ...base, status: "active", assignedBy: 1, assignedAt: now }).run();
      assert.equal(memberSeesPrograms(withId()), true, "coach-set live program shows the tab");
      db.update(schema.programEnrolments).set({ status: "ended" }).where(eq(schema.programEnrolments.clientId, cid)).run();
      assert.equal(memberSeesPrograms(withId()), false, "ended coach-set program does not count");
      db.delete(schema.programEnrolments).where(eq(schema.programEnrolments.clientId, cid)).run();
      db.delete(schema.clients).where(eq(schema.clients.id, cid)).run();
    });

    runWithTenant(tid, () => setFeatureFlags({ programs: false }));
    assert.equal(programsOn(tid), false, "the business's own switch still wins");
    console.log("programs/access: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
