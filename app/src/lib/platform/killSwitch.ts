import "server-only";

import { getPlatformSetting, setPlatformSetting } from "@/lib/billing/settings";

/**
 * Switches that stop one capability for every business at once.
 *
 * DELIBERATELY A LEAF. This module imports nothing but the platform-settings
 * reader, because the code that HAS to consult it is the code that spends
 * money: the AI gate, the email precheck, the post dispatcher. Those are
 * loaded in contexts (background jobs, tests) where pulling in the tenant
 * database proxy -- and through it React's server-only `cache` -- breaks
 * the import outright. The console's fleet list lives next door in
 * ./fleet.ts and may import whatever it likes.
 *
 * A kill switch exists for the afternoon a provider starts charging for
 * failures, or a bug starts sending the wrong thing to the wrong people.
 * Stopping the fleet then has to be one action, not thirty, and it has to
 * be readable by the code that would otherwise spend the money -- so each
 * switch is checked at the point of spend rather than at the point of
 * display.
 */

export type KillSwitchKey = "ai" | "email" | "posting";

export interface KillSwitchDef {
  key: KillSwitchKey;
  label: string;
  /** What actually stops, in the operator's terms. */
  blurb: string;
}

export const KILL_SWITCHES: KillSwitchDef[] = [
  { key: "ai", label: "AI generation", blurb: "Every paid model call across every business: agents, Content Studio, blogs, the daily brief." },
  { key: "email", label: "Email sending", blurb: "Campaign sends and the nurture sequence. Transactional mail (invites, password resets) keeps working." },
  { key: "posting", label: "Social posting", blurb: "Scheduled posts stay queued instead of going out." },
];

const KEY_PREFIX = "kill_switch_";

export interface KillSwitchState {
  key: KillSwitchKey;
  label: string;
  blurb: string;
  stopped: boolean;
  reason: string | null;
  since: number | null;
  by: string | null;
}

interface StoredSwitch {
  stopped: boolean;
  reason?: string;
  since?: number;
  by?: string;
}

function readSwitch(key: KillSwitchKey): StoredSwitch {
  const raw = getPlatformSetting(`${KEY_PREFIX}${key}`);
  if (!raw) return { stopped: false };
  try {
    const parsed = JSON.parse(raw) as StoredSwitch;
    return { ...parsed, stopped: parsed.stopped === true };
  } catch {
    return { stopped: false };
  }
}

/**
 * Whether one capability is stopped fleet-wide.
 *
 * Deliberately cheap and deliberately fail-open: a switch that cannot be
 * read must not stop the platform. The failure it guards against is a
 * provider misbehaving, not the control database being unavailable -- and
 * if the control database is unavailable nothing works anyway.
 */
export function isStopped(key: KillSwitchKey): boolean {
  try {
    return readSwitch(key).stopped;
  } catch {
    return false;
  }
}

export function listKillSwitches(): KillSwitchState[] {
  return KILL_SWITCHES.map((d) => {
    const s = readSwitch(d.key);
    return {
      key: d.key,
      label: d.label,
      blurb: d.blurb,
      stopped: s.stopped,
      reason: s.reason ?? null,
      since: s.since ?? null,
      by: s.by ?? null,
    };
  });
}

export type FleetResult = { ok: true; note: string } | { ok: false; error: string };

/** Stop or restart one capability for every business. Owner-only in the API. */
export function setKillSwitch(key: KillSwitchKey, stopped: boolean, reason: string, actor: string): FleetResult {
  if (!KILL_SWITCHES.some((s) => s.key === key)) return { ok: false, error: "Unknown switch." };
  if (stopped && reason.trim().length < 3) return { ok: false, error: "Say why the fleet is being stopped." };

  const value: StoredSwitch = stopped
    ? { stopped: true, reason: reason.trim(), since: Date.now(), by: actor }
    : { stopped: false };
  setPlatformSetting(`${KEY_PREFIX}${key}`, JSON.stringify(value));

  const label = KILL_SWITCHES.find((s) => s.key === key)!.label;
  return stopped
    ? { ok: true, note: `${label} is stopped for every business. Nothing is lost — it resumes where it left off.` }
    : { ok: true, note: `${label} is running again.` };
}
