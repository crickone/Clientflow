import "server-only";

import { resolveCurrentTenant } from "@/lib/db/tenant";

/**
 * The Training content was written for Renova and names it throughout
 * ("calling from Renova in Clonmel"). Two separate clinics use it, so every
 * page hands its content through `forClinic`, which puts the signed-in
 * clinic's own short name in place of "Renova". Short names, not the full
 * business name: these are lines staff say on the phone.
 */
const CLINIC_NAMES: Record<string, string> = {
  "optimal-health": "Optimal Health",
  renova: "Renova",
};

export function clinicName(): string {
  const slug = resolveCurrentTenant()?.slug ?? "";
  return CLINIC_NAMES[slug] ?? "Renova";
}

/** A deep copy of `data` with "Renova" replaced by the clinic's name in every string. */
export function forClinic<T>(data: T, name = clinicName()): T {
  if (name === "Renova") return data;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(/Renova/g, name);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(data) as T;
}
