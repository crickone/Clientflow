// Run: npm test -- src/app/workout/actions.buildFromUpload.test.ts
//
// buildProgramFromUploadAction ("Build from this file"): signed-in staff
// only (the same requireUser gate as the other workout actions, run for
// real against a scratch session), refuses a program that is not an Upload
// program before any model call, and otherwise hands back the converter's
// program and lines to check without saving anything. The converter is a
// fake here (no network, no paid model call).
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
  const { buildProgramFromUploadAction } = requireLocal("./actions") as typeof import("./actions");

  const slug = "build-from-upload-test";
  const email = "build-from-upload-test@x.ie";
  const wipe = () => {
    controlSqlite.prepare("DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)").run(email);
    controlSqlite.prepare("DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email = ?)").run(email);
    controlSqlite.prepare("DELETE FROM users WHERE email = ?").run(email);
    controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
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
    await assert.rejects(() => buildProgramFromUploadAction(uploadId), /UNAUTHENTICATED/, "signed out is refused");
    ok("signed out: refused", importCalls.length === 0);

    cookieToken = rawSession;

    const notUpload = await buildProgramFromUploadAction(detailedId);
    ok("non-upload program refused", !notUpload.ok && notUpload.error === "Only an uploaded program can be built from its file.");
    ok("non-upload: converter not called", importCalls.length === 0);

    const missing = await buildProgramFromUploadAction(999_999);
    ok("unknown program refused", !missing.ok && missing.error === "I can't find that program.");
    const badId = await buildProgramFromUploadAction(-1);
    ok("bad id refused", !badId.ok && importCalls.length === 0);

    const draft = { ...blankProgram("detailed"), title: "Coach sheet copy" };
    fakeImport = async () => ({ ok: true, program: draft, unplaced: ["Row 4: note"], summary: "Coach sheet copy: 1 day, 0 exercises" });
    const built = await buildProgramFromUploadAction(uploadId);
    ok("upload program: converter called with its id", importCalls.join(",") === String(uploadId));
    ok("upload program: program and lines handed back", built.ok && built.program.title === "Coach sheet copy" && built.unplaced.join() === "Row 4: note");
    ok("upload program: nothing saved", countPrograms() === before);

    fakeImport = async () => ({ ok: false, error: "The uploaded file is missing." });
    const failed = await buildProgramFromUploadAction(uploadId);
    ok("converter error passed through", !failed.ok && failed.error === "The uploaded file is missing.");
  } finally {
    wipe();
  }

  console.log(`actions.buildFromUpload.test.ts: all ${passed} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
