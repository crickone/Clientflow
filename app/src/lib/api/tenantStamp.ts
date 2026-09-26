import "server-only";

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { getTenantById, resolveCurrentTenant } from "@/lib/db/tenant";
import { TENANT_MISMATCH_CODE, TENANT_STAMP_HEADER, parseStamp } from "./tenantStampRules";

/**
 * The tenant a browser tab BELIEVES it is showing.
 *
 * THE BUG THIS EXISTS FOR. The active tenant lives on the session ROW
 * (auth_sessions.active_tenant_id, written by chooseAccount in @/lib/auth), and
 * a session row is shared by every tab in the browser. So switching clinic in
 * one tab silently repoints every OTHER open tab: the screen still shows
 * Inspire, the next request resolves Optimal Health. An operator hit this
 * redesigning a Content Studio slide and got "Design not found." — the design
 * was there, just in the clinic they were no longer in.
 *
 * The 404 was luck. Nothing in a URL carries the tenant, so ids collide across
 * clinics: had that id existed in both, the redesign would have rewritten the
 * OTHER clinic's slide and reported success. That is the failure this guards —
 * the confusing error message is only its most visible form.
 *
 * So the root layout stamps the tenant it rendered for onto <html>, a fetch
 * wrapper sends it back on every /api call (@/components/layout/TenantTabGuard),
 * and `guard()` refuses any request whose stamp disagrees with the tenant the
 * session now resolves to. Fail closed: a request that cannot prove which
 * clinic it meant does not get to write to one.
 *
 * ABSENT IS NOT MISMATCHED. Webhooks, cron, the client mobile app and any
 * server-to-server caller send no stamp, and must keep working untouched — so
 * the check only fires when a stamp is present AND disagrees. It narrows what a
 * browser tab can do; it grants nothing.
 */
export { TENANT_MISMATCH_CODE, TENANT_STAMP_HEADER } from "./tenantStampRules";

/**
 * The refusal, or null when the request is consistent (including when it
 * carries no stamp at all).
 *
 * 409 Conflict rather than 403: the caller is perfectly entitled to both
 * clinics — what it is not entitled to do is act on one while displaying the
 * other. The message names BOTH businesses, because "which clinic am I in" is
 * precisely the thing the operator has lost track of, and an error that does
 * not answer it sends them to look at the wrong thing.
 */
export function tenantStampMismatch(): Response | null {
  let stampedId: number | null = null;
  try {
    stampedId = parseStamp(headers().get(TENANT_STAMP_HEADER));
  } catch {
    // Outside a request scope — nothing to check.
    return null;
  }
  if (stampedId === null) return null;

  const current = resolveCurrentTenant();
  // No resolvable tenant is the auth layer's business, not this one — guard()
  // has already refused, or the handler binds its own tenant explicitly.
  if (!current || current.id === stampedId) return null;

  const was = getTenantById(stampedId);
  return NextResponse.json(
    {
      ok: false,
      code: TENANT_MISMATCH_CODE,
      error:
        `This tab is showing ${was?.name ?? "another account"}, but you have since switched to ` +
        `${current.name} in another tab. One browser can only be in one account at a time. ` +
        `Reload this tab to continue in ${current.name}, or switch back to ${was?.name ?? "it"}.`,
      stampedTenant: was ? { id: was.id, name: was.name } : null,
      currentTenant: { id: current.id, name: current.name },
    },
    { status: 409 },
  );
}
