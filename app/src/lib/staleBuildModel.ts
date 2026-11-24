/**
 * Pure rules for noticing a page left open across a deploy.
 *
 * A deploy changes the ids of the page's server actions, so the next click on
 * an old page fails with "Failed to find Server Action ... from an older or
 * newer deployment" and the route's error screen shows. That is not a fault:
 * reloading fixes it.
 */
export function looksLikeStaleDeploy(message: string | null | undefined): boolean {
  return /server action|failed-to-find-server-action|older or newer deployment/i.test(message ?? "");
}

/** Reload at most once per new build, so a real error can never loop the page. */
export function shouldAutoReload(opts: { pageBuild: string | null; liveBuild: string | null; reloadedFor: string | null }): boolean {
  const { pageBuild, liveBuild, reloadedFor } = opts;
  if (!pageBuild || !liveBuild || pageBuild === liveBuild) return false;
  return reloadedFor !== liveBuild;
}
