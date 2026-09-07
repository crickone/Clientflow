/**
 * The pure decision behind "Delete site": whether the operator has typed the
 * right confirmation and whether a live domain still blocks the delete. Kept
 * free of runtime imports (no "server-only", no db, no drizzle) so it loads
 * under the plain tsx test runner and so the two guardrails — typed slug,
 * verified-domain block — are exercised without a database.
 *
 * The server action (src/app/cms/actions.ts) is the only caller that may
 * treat this as authoritative: it re-derives `confirmSlug`/`verifiedDomains`
 * from the request rather than trusting anything the client sends, so this
 * function is the enforcement point, not just a UI hint.
 */
export function canDeleteSite(input: {
  confirmSlug: string;
  siteSlug: string;
  verifiedDomains: number;
}): { ok: true } | { ok: false; reason: string } {
  if (input.confirmSlug !== input.siteSlug) {
    return { ok: false, reason: "Type the site's slug exactly to confirm deletion." };
  }
  if (input.verifiedDomains > 0) {
    return {
      ok: false,
      reason:
        "This site still has a verified domain mapped. Remove the domain before deleting the site.",
    };
  }
  return { ok: true };
}
