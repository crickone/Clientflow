/**
 * Pure: finding the client at the desk, and the bits of their name the
 * booking screen shows. No DB, no React.
 */

import { fullDate } from "./format";

export interface ClientLike {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
}

/** Up to `limit` clients whose name, email or phone contains the query. An empty query lists the first `limit`. */
export function searchClients<T extends ClientLike>(clients: T[], query: string, limit = 10): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return clients.slice(0, limit);
  return clients
    .filter((c) => `${c.firstName} ${c.lastName} ${c.email ?? ""} ${c.phone}`.toLowerCase().includes(q))
    .slice(0, limit);
}

/** "Mary Anne Smith" -> ["Mary", "Anne Smith"]: a voucher recipient's name as walk-in first/last name. */
export function splitName(full?: string | null): [string, string] {
  if (!full || !full.trim()) return ["", ""];
  const parts = full.trim().split(/\s+/);
  return [parts[0], parts.slice(1).join(" ")];
}

/** Walk-ins are stored with "—" for a missing last name or phone. */
function real(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v === "—" ? "" : v;
}

/** "AM" for the avatar. "?" when there is no name at all. */
export function initials(firstName: string, lastName: string): string {
  const a = real(firstName)[0] ?? "";
  const b = real(lastName)[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

/** "Mary Smith" (no trailing dash for a walk-in with no last name). */
export function displayName(firstName: string, lastName: string): string {
  return [real(firstName), real(lastName)].filter(Boolean).join(" ");
}

/** "083 000 0000 · Client since 24 Nov 2026". Leaves out a missing phone. */
export function clientSubline(
  phone: string,
  createdAt: Date | string | number | null | undefined,
  memberWord: string,
): string {
  const bits: string[] = [];
  if (real(phone)) bits.push(real(phone));
  if (createdAt != null && createdAt !== "") {
    const d = new Date(createdAt);
    if (!Number.isNaN(d.getTime())) bits.push(`${memberWord} since ${fullDate(d.toISOString().slice(0, 10))}`);
  }
  return bits.join(" · ");
}
