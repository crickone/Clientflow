/**
 * Account-level pages that sit OUTSIDE a tenant: sign-in, password recovery,
 * account selection, invite acceptance.
 *
 * Two places need to agree about this list. `src/app/layout.tsx` uses it on the
 * server to skip the tenant guards — no active membership must not redirect
 * someone to /select-account while they are trying to recover a password — and
 * `AppShell` uses it on the client to render without the sidebar.
 *
 * They were two hand-maintained arrays and they drifted: /forgot-password and
 * /reset-password were added to the server list and not the client one, so a
 * signed-in operator opening the reset page got the full admin chrome wrapped
 * around it. The bug hid for months because AppShell also bails out when there
 * is no user, so nobody signed OUT could ever see it. One array now, imported
 * by both — no `server-only`, no imports, so it loads in either tree.
 */
export const BARE_PATHS = [
  "/login",
  "/change-password",
  "/select-account",
  "/accept-invite",
  "/forgot-password",
  "/reset-password",
] as const;

/** True for a bare path itself and anything beneath it (/reset-password/abc123). */
export function isBarePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return BARE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
