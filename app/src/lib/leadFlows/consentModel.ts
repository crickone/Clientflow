/** Marketing consent for leads, the pure part. */

export type ConsentSource = "staff" | "form" | "api";

const YES = new Set(["true", "yes", "y", "1", "on", "agreed", "agree"]);

/** Whether a posted value means yes (true, 1, "yes", "on"...). Anything else is no. */
export function isConsentYes(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === "string") return YES.has(v.trim().toLowerCase());
  return false;
}
