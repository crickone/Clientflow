/**
 * The one Graph API version every Meta call in the app uses. Meta retires a
 * version about two years after release (v21.0 dies 2027-01-21), so bump it
 * here, not per call site. No `server-only`: tests import it.
 */
export const GRAPH_VERSION = "v26.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
