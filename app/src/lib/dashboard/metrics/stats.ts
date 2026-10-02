/** Pure statistics helpers for dashboard widgets. No imports beyond types. */

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export type Bucket = { key: string; label: string; startMs: number; endMs: number };

function dayLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function seriesBuckets(fromMs: number, toMs: number): Bucket[] {
  const out: Bucket[] = [];
  const days = Math.max(0, Math.ceil((toMs - fromMs) / DAY));
  const step = days <= 31 ? DAY : 7 * DAY;
  for (let start = fromMs; start < toMs; start += step) {
    const endMs = Math.min(start + step, toMs);
    const key = new Date(start).toISOString().slice(0, 10);
    out.push({ key, label: days <= 31 ? dayLabel(start) : `w/c ${dayLabel(start)}`, startMs: start, endMs });
  }
  return out;
}

export function bucketIndex(buckets: Bucket[], ms: number): number {
  return buckets.findIndex((b) => ms >= b.startMs && ms < b.endMs);
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function weekdayHourGrid(timestampsMs: number[], timeZone: string): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23" });
  for (const ms of timestampsMs) {
    const parts = fmt.formatToParts(new Date(ms));
    const wd = WEEKDAYS.indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
    if (wd >= 0 && hour >= 0 && hour < 24) grid[wd][hour]++;
  }
  return grid;
}

export type Msg = { convo: string; direction: "inbound" | "outbound"; atMs: number; channel: string };

export function firstResponseTimes(msgs: Msg[]): { channel: string; minutes: number; inboundAtMs: number }[] {
  const byConvo = new Map<string, Msg[]>();
  for (const m of msgs) {
    const list = byConvo.get(m.convo);
    if (list) list.push(m);
    else byConvo.set(m.convo, [m]);
  }
  const out: { channel: string; minutes: number; inboundAtMs: number }[] = [];
  for (const list of byConvo.values()) {
    const sorted = [...list].sort((a, b) => a.atMs - b.atMs);
    let pending: Msg | null = null;
    let prev: Msg | null = null;
    for (const m of sorted) {
      if (m.direction === "inbound") {
        if (!pending && (!prev || prev.direction !== "inbound")) pending = m;
      } else if (pending) {
        out.push({ channel: pending.channel, minutes: (m.atMs - pending.atMs) / 60_000, inboundAtMs: pending.atMs });
        pending = null;
      }
      prev = m;
    }
  }
  return out;
}

export type StageEv = { leadId: number; fromStageId: number | null; toStageId: number; atMs: number };

function byLead(events: StageEv[]): Map<number, StageEv[]> {
  const m = new Map<number, StageEv[]>();
  for (const e of events) {
    const list = m.get(e.leadId);
    if (list) list.push(e);
    else m.set(e.leadId, [e]);
  }
  for (const list of m.values()) list.sort((a, b) => a.atMs - b.atMs);
  return m;
}

export function timeInStage(events: StageEv[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const list of byLead(events).values()) {
    let openStage: number | null = null;
    let openAt = 0;
    for (const e of list) {
      if (openStage !== null && e.fromStageId === openStage) {
        const arr = out.get(openStage);
        const dur = e.atMs - openAt;
        if (arr) arr.push(dur);
        else out.set(openStage, [dur]);
      }
      openStage = e.toStageId;
      openAt = e.atMs;
    }
  }
  return out;
}

export function velocityDays(events: StageEv[], wonStageIds: Set<number>, fromMs: number, toMs: number): number[] {
  const out: number[] = [];
  for (const list of byLead(events).values()) {
    const created = list.find((e) => e.fromStageId === null);
    const won = list.find((e) => wonStageIds.has(e.toStageId));
    if (!created || !won || won.atMs < fromMs || won.atMs >= toMs) continue;
    out.push(Math.round(((won.atMs - created.atMs) / DAY) * 10) / 10);
  }
  return out;
}
