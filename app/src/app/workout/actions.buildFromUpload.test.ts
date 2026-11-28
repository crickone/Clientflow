// Run: npm test -- src/app/workout/actions.buildFromUpload.test.ts
//
// "Build from this file": startBuildFromUploadAction + pollBuildFromUploadAction.
// Signed-in staff only (the same requireUser gate as the other workout
// actions, run for real against a scratch session). A program that is not
// an Upload program is refused before any model call. Otherwise the import
// runs detached as a job bound to the tenant (getCurrentTenant works inside
// it) and the user; polling returns "running" until it ends, then the
// converter's program and lines to check, without saving anything. Another
// user, or another business, cannot read the job. The converter is a fake
// here (no network, no paid model call).
import { tokenKey } from "../../lib/security/tokenKey";
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

import type { ImportResult } from "../../lib/workoutImport/model";

let cookieToken: string | undefined;
let sessionCookieName = "";
let importCalls: number[] = [];
let fakeImport: (programId: number) => Promise<ImportResult> = async () => ({ ok: false, error: "not set" });

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/headers") {
    return {
      cookies: () => ({
        get: (name: string) => (cookieToken && name === sessionCookieName ? { value: cookieToken } : undefined),
        set: () => {},
        delete: () => {},
      }),
      headers: () => new Headers(),
    };
  }
  if (request === "next/navigation") {
    return {
      redirect: (to: string) => {
        throw new Error(`redirect:${to}`);
      },
    };
  }
  if (request === "next/cache") return { revalidatePath: () => {} };
  if (request === "@/lib/workoutImport/convert") {
    return {
      importProgramFromUpload: (id: number) => {
        importCalls.push(id);
        return fakeImport(id);
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite, SESSION_COOKIE } = requireLocal("../../lib/db/control") as typeof import("../../lib/db/control");
  sessionCookieName = SESSION_COOKIE;
  const { getTenantDbById, runWithTenant } = requireLocal("../../lib/db/tenant") as typeof import("../../lib/db/tenant");
  const { saveProgram, listPrograms } = requireLocal("../../lib/workout") as typeof import("../../lib/workout");
  const { blankProgram } = requireLocal("../../lib/workoutModel") as typeof import("../../lib/workoutModel");
  const { startBuildFromUploadAction, pollBuildFromUploadAction } = requireLocal("./actions") as typeof import("./actions");
  const { getCurrentTenant } = requireLocal("../../lib/db/tenant") as typeof import("../../lib/db/tenant");
  type Poll = Awaited<ReturnType<typeof pollBuildFromUploadAction>>;
  // Starts a build and polls it to the end (the client polls every 3 s; here every 5 ms).
  const build = async (programId: number): Promise<Poll> => {
    const started = await startBuildFromUploadAction(programId);
    if (!started.ok) return started;
    for (let i = 0; i < 400; i++) {
      const r = await pollBuildFromUploadAction(started.jobId);
      if (!("status" in r)) return r;
      await new Promise((res) => setTimeout(res, 5));
    }
    throw new Error("the job never finished");
  };

  const slug = "build-from-upload-test";
  const email = "build-from-upload-test@x.ie";
  const email2 = "build-from-upload-test-2@x.ie";
  const slug2 = "build-from-upload-test-2";
  const wipe = () => {
    for (const e of [email, email2]) {
      controlSqlite.prepare("DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)").run(e);
      controlSqlite.prepare("DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email = ?)").run(e);
      controlSqlite.prepare("DELETE FROM users WHERE email = ?").run(e);
    }
    for (const sl of [slug, slug2]) {
      controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(sl);
      try {
        fs.rmSync(path.join(process.cwd(), "data", "tenants", sl), { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  };
  wipe();

  const tid = (
    controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, slug, `tenants/${slug}/${slug}.db`) as { id: number }
  ).id;
  const user = controlSqlite
    .prepare("INSERT INTO users (email, password_hash, role, is_active) VALUES (?, 'x', 'staff', 1) RETURNING id")
    .get(email) as { id: number };
  controlSqlite.prepare("INSERT INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, 'staff', 1)").run(user.id, tid);
  const rawSession = `build-from-upload-session-${Date.now()}`;
  controlSqlite
    .prepare("INSERT INTO auth_sessions (id, user_id, active_tenant_id, expires_at) VALUES (?, ?, ?, ?)")
    .run(tokenKey(rawSession), user.id, tid, Date.now() + 3_600_000);
  // A second staff user of the same business, also a member of a second business.
  const tid2 = (
    controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug2, slug2, `tenants/${slug2}/${slug2}.db`) as { id: number }
  ).id;
  const user2 = controlSqlite
    .prepare("INSERT INTO users (email, password_hash, role, is_active) VALUES (?, 'x', 'staff', 1) RETURNING id")
    .get(email2) as { id: number };
  controlSqlite.prepare("INSERT INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, 'staff', 1)").run(user2.id, tid);
  controlSqlite.prepare("INSERT INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, 'staff', 1)").run(user.id, tid2);
  const otherUserSession = `build-from-upload-session-2-${Date.now()}`;
  controlSqlite
    .prepare("INSERT INTO auth_sessions (id, user_id, active_tenant_id, expires_at) VALUES (?, ?, ?, ?)")
    .run(tokenKey(otherUserSession), user2.id, tid, Date.now() + 3_600_000);
  const otherTenantSession = `build-from-upload-session-3-${Date.now()}`;
  controlSqlite
    .prepare("INSERT INTO auth_sessions (id, user_id, active_tenant_id, expires_at) VALUES (?, ?, ?, ?)")
    .run(tokenKey(otherTenantSession), user.id, tid2, Date.now() + 3_600_000);

  let passed = 0;
  const ok = (name: string, cond: boolean) => {
    assert.ok(cond, name);
    passed++;
  };

  try {
    getTenantDbById(tid);
    const { detailedId, uploadId } = runWithTenant(tid, () => {
      const detailed = { ...blankProgram("detailed"), title: "Hand built" };
      // A detailed program with a stray upload name must still be refused.
      detailed.uploadFilename = "program-1-1.xlsx";
      const upload = { ...blankProgram("upload"), title: "Coach sheet", uploadFilename: "program-2-2.xlsx", uploadOriginalName: "block.xlsx" };
      return { detailedId: saveProgram(detailed), uploadId: saveProgram(upload) };
    });
    const countPrograms = () => runWithTenant(tid, () => listPrograms().length);
    const before = countPrograms();

    // Signed out: the gate runs before anything else.
    cookieToken = undefined;
    await assert.rejects(() => startBuildFromUploadAction(uploadId), /UNAUTHENTICATED/, "signed out is refused");
    await assert.rejects(() => pollBuildFromUploadAction("x"), /UNAUTHENTICATED/, "signed out poll is refused");
    ok("signed out: refused", importCalls.length === 0);

    cookieToken = rawSession;

    const notUpload = await startBuildFromUploadAction(detailedId);
    ok("non-upload program refused", !notUpload.ok && notUpload.error === "Only an uploaded program can be built from its file.");
    ok("non-upload: converter not called", importCalls.length === 0);

    const missing = await startBuildFromUploadAction(999_999);
    ok("unknown program refused", !missing.ok && missing.error === "I can't find that program.");
    const badId = await startBuildFromUploadAction(-1);
    ok("bad id refused", !badId.ok && importCalls.length === 0);

    // The job runs detached: the start returns before the converter ends,
    // and the converter runs inside the job's tenant.
    const draft = { ...blankProgram("detailed"), title: "Coach sheet copy" };
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let tenantInJob = 0;
    fakeImport = async () => {
      await gate;
      tenantInJob = getCurrentTenant().id;
      return { ok: true, program: draft, unplaced: ["Row 4: note"], summary: "Coach sheet copy: 1 day, 0 exercises" };
    };
    const started = await startBuildFromUploadAction(uploadId);
    ok("start: a job id at once", started.ok && /^[0-9a-f]{32}$/.test(started.jobId));
    const jobId = started.ok ? started.jobId : "";
    const running = await pollBuildFromUploadAction(jobId);
    ok("poll: running while the converter works", "status" in running && running.status === "running");

    cookieToken = otherUserSession;
    const otherUser = await pollBuildFromUploadAction(jobId);
    ok("another user cannot read the job", !("status" in otherUser) && !otherUser.ok);
    cookieToken = otherTenantSession;
    const otherTenant = await pollBuildFromUploadAction(jobId);
    ok("the same user in another business cannot read the job", !("status" in otherTenant) && !otherTenant.ok);
    cookieToken = rawSession;

    release();
    let done: Poll = { status: "running" };
    for (let i = 0; i < 400 && "status" in done; i++) {
      await new Promise((res) => setTimeout(res, 5));
      done = await pollBuildFromUploadAction(jobId);
    }
    ok("upload program: converter called with its id", importCalls.join(",") === String(uploadId));
    ok("upload program: program and lines handed back", !("status" in done) && done.ok && done.program.title === "Coach sheet copy" && done.unplaced.join() === "Row 4: note");
    ok("job ran inside its tenant", tenantInJob === tid);
    ok("upload program: nothing saved", countPrograms() === before);
    const again = await pollBuildFromUploadAction(jobId);
    ok("a finished job can be read again", !("status" in again) && again.ok);
    const unknown = await pollBuildFromUploadAction("0".repeat(32));
    ok("unknown job: plain message", !("status" in unknown) && !unknown.ok && unknown.error === "That build has stopped. Try again.");

    fakeImport = async () => ({ ok: false, error: "The uploaded file is missing." });
    const failed = await build(uploadId);
    ok("converter error passed through", !("status" in failed) && !failed.ok && failed.error === "The uploaded file is missing.");

    fakeImport = async () => {
      throw new Error("boom");
    };
    const thrown = await build(uploadId);
    ok("a throw ends the job with a plain error", !("status" in thrown) && !thrown.ok && thrown.error === "I couldn't build the program just now. Try again in a moment.");
  } finally {
    wipe();
  }

  console.log(`actions.buildFromUpload.test.ts: all ${passed} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
