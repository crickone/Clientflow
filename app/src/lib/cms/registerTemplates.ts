import "server-only";

/**
 * Side-effect module: imports site-specific template modules so their
 * registerTemplate() calls run before any public page renders. The base
 * templates (basic-page, renova-html) are registered in templates.tsx itself.
 * Renova structured templates are added in a later phase and imported here.
 */

import "@/lib/cms/sites/renova/templates";
export {};
