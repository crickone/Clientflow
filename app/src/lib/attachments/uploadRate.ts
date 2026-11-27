/**
 * Uploads per staff member on /api/messages/attachments: 60 every 10 minutes
 * (12 full messages of 5 files). Every business shares one disk, so a script
 * or a stuck tab must not be able to fill it. Counted per user, before the
 * body is read. Kept here, not in the route file: a route module may only
 * export its handlers and Next's route options.
 */
export const UPLOAD_RATE_LIMIT = 60;
export const UPLOAD_RATE_WINDOW_MS = 10 * 60 * 1000;
export const UPLOAD_RATE_ERROR = "You've attached a lot of files in the last few minutes. Wait a few minutes, then try again.";
