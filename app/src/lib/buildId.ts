/**
 * Which deployment this server process is. Railway sets RAILWAY_DEPLOYMENT_ID
 * per deploy; locally it falls back to the process start, which changes on
 * every restart. An open page compares its own value with /api/version to
 * notice that a new version went live underneath it.
 */
const started = String(Date.now());
export const BUILD_ID: string =
  process.env.RAILWAY_DEPLOYMENT_ID?.trim() || process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || started;
