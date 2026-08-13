/**
 * Pure human-name helpers. Deliberately NO `import "server-only"` and no DB —
 * so it's importable both from server code (leads.ts) and directly under the
 * plain-tsx test runner (humanName.test.ts). Same reasoning as the other
 * pure-util modules that stay test-runner-safe.
 */

/**
 * Split a single "full name" into first + last: the first whitespace-separated
 * token is the first name; everything after it is the last name (so multi-word
 * surnames like "van der Berg" stay intact). Empty/whitespace -> both null.
 * Lets an integration send one "Full name" field and have us split it once,
 * server-side, instead of in every Zapier/Make scenario.
 */
export function splitFullName(full: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const clean = (full ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return { firstName: null, lastName: null };
  const sp = clean.indexOf(" ");
  if (sp === -1) return { firstName: clean, lastName: null };
  return { firstName: clean.slice(0, sp), lastName: clean.slice(sp + 1) };
}
