"use client";

import { useTransition } from "react";

import { setStaffRoleAction } from "@/app/(console)/staff/actions";
import type { PlatformRole } from "@/lib/types";

/**
 * A role picker that submits on change. No Save button, because the only
 * thing this form holds is one value and an unsaved dropdown is a lie about
 * who currently has access.
 *
 * The owner's own row is disabled: a lone owner demoting themselves would
 * leave nobody able to promote anyone back. The API refuses it too.
 */
export function StaffRoleForm({
  userId,
  role,
  isSelf,
}: {
  userId: number;
  role: PlatformRole;
  isSelf: boolean;
}) {
  const [pending, start] = useTransition();
  const action = setStaffRoleAction.bind(null, userId);

  return (
    <form
      action={(fd) => start(() => action(fd))}
      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
    >
      <label htmlFor={`role-${userId}`} className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        Role
      </label>
      <select
        id={`role-${userId}`}
        name="role"
        defaultValue={role}
        disabled={pending || isSelf}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="input"
        style={{ height: 32, padding: "0 8px", fontSize: 13, cursor: isSelf ? "not-allowed" : "pointer" }}
        title={isSelf ? "You cannot change your own role." : undefined}
      >
        <option value="owner">owner</option>
        <option value="manager">manager</option>
      </select>
      {pending && <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>saving…</span>}
    </form>
  );
}
