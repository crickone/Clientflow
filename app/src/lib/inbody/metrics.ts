/**
 * InBody body-composition results: the measurements we keep, and how to read
 * them out of whatever shape InBody hands us. Pure -- no I/O -- so the webhook,
 * the hourly pull and the CSV import all read results the same way.
 *
 * InBody names one measurement several ways depending on the endpoint and the
 * device: the abbreviated API returns "SMM", the full API "SMM(SkeletalMuscleMass)",
 * and a LookinBody CSV export "SMM(Skeletal Muscle Mass)". Matching on a
 * normalised key (lower case, letters and digits only, "%" kept as "pct") lets
 * one alias list cover all three.
 */

export type MetricKey =
  | "weight"
  | "smm"
  | "bfm"
  | "pbf"
  | "bmi"
  | "ffm"
  | "tbw"
  | "vfl"
  | "bmr"
  | "score"
  | "whr"
  | "leanRightArm"
  | "leanLeftArm"
  | "leanTrunk"
  | "leanRightLeg"
  | "leanLeftLeg";

export interface MetricDef {
  key: MetricKey;
  label: string;
  unit: string;
  decimals: number;
  /** Which way is progress, for colouring a change. null = neither. */
  better: "up" | "down" | null;
  aliases: string[];
}

export const METRICS: MetricDef[] = [
  { key: "weight", label: "Weight", unit: "kg", decimals: 1, better: null, aliases: ["WT", "Weight", "Weight(kg)", "BodyWeight"] },
  { key: "smm", label: "Skeletal muscle mass", unit: "kg", decimals: 1, better: "up", aliases: ["SMM", "SkeletalMuscleMass", "SMM(SkeletalMuscleMass)"] },
  { key: "bfm", label: "Body fat mass", unit: "kg", decimals: 1, better: "down", aliases: ["BFM", "BodyFatMass", "BFM(BodyFatMass)"] },
  { key: "pbf", label: "Body fat", unit: "%", decimals: 1, better: "down", aliases: ["PBF", "PercentBodyFat", "PBF(PercentBodyFat)", "BodyFatPercent", "BodyFat(%)"] },
  { key: "bmi", label: "BMI", unit: "", decimals: 1, better: null, aliases: ["BMI", "BodyMassIndex", "BMI(BodyMassIndex)"] },
  { key: "ffm", label: "Lean body mass", unit: "kg", decimals: 1, better: "up", aliases: ["FFM", "FatFreeMass", "FFM(FatFreeMass)", "LBM", "LeanBodyMass", "LBM(LeanBodyMass)"] },
  { key: "tbw", label: "Total body water", unit: "kg", decimals: 1, better: null, aliases: ["TBW", "TotalBodyWater", "TBW(TotalBodyWater)"] },
  { key: "vfl", label: "Visceral fat level", unit: "", decimals: 0, better: "down", aliases: ["VFL", "VisceralFatLevel", "VFL(VisceralFatLevel)"] },
  { key: "bmr", label: "Basal metabolic rate", unit: "kcal", decimals: 0, better: null, aliases: ["BMR", "BasalMetabolicRate", "BMR(BasalMetabolicRate)"] },
  { key: "score", label: "InBody score", unit: "", decimals: 0, better: "up", aliases: ["InBodyScore", "IBS", "InBodyScore(Points)"] },
  { key: "whr", label: "Waist-hip ratio", unit: "", decimals: 2, better: "down", aliases: ["WHR", "WaistHipRatio", "WHR(WaistHipRatio)"] },
  { key: "leanRightArm", label: "Lean mass, right arm", unit: "kg", decimals: 2, better: "up", aliases: ["LeanMassofRightArm", "LRA", "SLMRA", "LeanRightArm"] },
  { key: "leanLeftArm", label: "Lean mass, left arm", unit: "kg", decimals: 2, better: "up", aliases: ["LeanMassofLeftArm", "LLA", "SLMLA", "LeanLeftArm"] },
  { key: "leanTrunk", label: "Lean mass, trunk", unit: "kg", decimals: 1, better: "up", aliases: ["LeanMassofTrunk", "LT", "SLMTR", "LeanTrunk"] },
  { key: "leanRightLeg", label: "Lean mass, right leg", unit: "kg", decimals: 2, better: "up", aliases: ["LeanMassofRightLeg", "LRL", "SLMRL", "LeanRightLeg"] },
  { key: "leanLeftLeg", label: "Lean mass, left leg", unit: "kg", decimals: 2, better: "up", aliases: ["LeanMassofLeftLeg", "LLL", "SLMLL", "LeanLeftLeg"] },
];

export const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m])) as Record<MetricKey, MetricDef>;

/** The headline set, in the order a person reads them. */
export const HEADLINE_METRICS: MetricKey[] = ["weight", "smm", "pbf", "bfm", "vfl", "bmr"];

export type Metrics = Partial<Record<MetricKey, number>>;

export function normKey(k: string): string {
  return k.toLowerCase().replace(/%/g, "pct").replace(/[^a-z0-9]/g, "");
}

const ALIAS_TO_KEY: Map<string, MetricKey> = (() => {
  const m = new Map<string, MetricKey>();
  for (const def of METRICS) for (const a of def.aliases) m.set(normKey(a), def.key);
  return m;
})();

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(",", ".");
  const match = s.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

/** Every key/value in an object, a few levels deep (results are sometimes nested). */
function entries(obj: unknown, depth = 0): [string, unknown][] {
  if (!obj || typeof obj !== "object") return [];
  const out: [string, unknown][] = [];
  const list = Array.isArray(obj) ? obj.map((v, i) => [String(i), v] as [string, unknown]) : Object.entries(obj as Record<string, unknown>);
  for (const [k, v] of list) {
    out.push([k, v]);
    if (depth < 3 && v && typeof v === "object") out.push(...entries(v, depth + 1));
  }
  return out;
}

/** Read every known measurement out of an InBody result object or CSV row object. */
export function readMetrics(raw: unknown): Metrics {
  const out: Metrics = {};
  for (const [k, v] of entries(raw)) {
    const key = ALIAS_TO_KEY.get(normKey(k));
    if (!key || out[key] !== undefined) continue;
    const n = toNum(v);
    if (n !== null && n > 0) out[key] = n;
  }
  return out;
}

export function hasMetrics(m: Metrics): boolean {
  return Object.keys(m).length > 0;
}

/** Merge two readings of the same scan, the first winning where both have a value. */
export function mergeMetrics(primary: Metrics, secondary: Metrics): Metrics {
  return { ...secondary, ...primary };
}

export function formatMetric(key: MetricKey, value: number | undefined | null): string {
  if (value === undefined || value === null) return "-";
  const def = METRIC_BY_KEY[key];
  const n = value.toLocaleString("en-IE", { minimumFractionDigits: def.decimals, maximumFractionDigits: def.decimals });
  return def.unit === "%" ? `${n}%` : def.unit ? `${n} ${def.unit}` : n;
}

/** "+1.2 kg" / "-0.4%" / "0", or null when either side is missing. */
export function formatChange(key: MetricKey, now: number | undefined, before: number | undefined): { text: string; tone: "good" | "bad" | "flat" } | null {
  if (now === undefined || before === undefined) return null;
  const def = METRIC_BY_KEY[key];
  const diff = now - before;
  const rounded = Number(diff.toFixed(def.decimals));
  if (rounded === 0) return { text: "No change", tone: "flat" };
  const abs = Math.abs(rounded).toLocaleString("en-IE", { minimumFractionDigits: def.decimals, maximumFractionDigits: def.decimals });
  const unit = def.unit === "%" ? " pts" : def.unit ? ` ${def.unit}` : "";
  const text = `${rounded > 0 ? "+" : "-"}${abs}${unit}`;
  const tone = def.better === null ? "flat" : (rounded > 0) === (def.better === "up") ? "good" : "bad";
  return { text, tone };
}

// ---- Dates ---------------------------------------------------------------

/**
 * The offset (ms) of Europe/Dublin from UTC at a given instant. The scanner
 * stamps scans in local time with no zone, and the server runs in UTC.
 */
function dublinOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - utcMs;
}

/** Irish local wall-clock time to a UTC instant (ms). */
export function dublinLocalToUtc(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number | null {
  if (![y, mo, d, h, mi, s].every(Number.isFinite)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  return guess - dublinOffsetMs(guess - dublinOffsetMs(guess));
}

/** InBody's "yyyyMMddHHmmss" (seconds and time optional) to a UTC instant. */
export function parseInBodyDatetime(input: string | null | undefined): number | null {
  if (!input) return null;
  const s = String(input).replace(/\D+/g, "");
  if (s.length < 8) return null;
  return dublinLocalToUtc(
    Number(s.slice(0, 4)),
    Number(s.slice(4, 6)),
    Number(s.slice(6, 8)),
    Number(s.slice(8, 10) || "0"),
    Number(s.slice(10, 12) || "0"),
    Number(s.slice(12, 14) || "0"),
  );
}

/** A UTC instant back to InBody's local "yyyyMMddHHmmss". */
export function formatInBodyDatetime(utcMs: number): string {
  const local = new Date(utcMs + dublinOffsetMs(utcMs));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${local.getUTCFullYear()}${p(local.getUTCMonth() + 1)}${p(local.getUTCDate())}${p(local.getUTCHours())}${p(local.getUTCMinutes())}${p(local.getUTCSeconds())}`;
}

/** Today's date as InBody's "yyyyMMdd", in Irish time. */
export function inbodyToday(nowMs = Date.now()): string {
  return formatInBodyDatetime(nowMs).slice(0, 8);
}

/**
 * A date as a person or a CSV export writes it: "2026-10-12 08:30",
 * "12/10/2026 08:30", "12.10.2026", or InBody's packed digits. Day-first,
 * as in Ireland.
 */
export function parseLooseDate(input: string | null | undefined): number | null {
  if (!input) return null;
  const s = String(input).trim();
  if (/^\d{8,14}$/.test(s)) return parseInBodyDatetime(s);
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return dublinLocalToUtc(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return dublinLocalToUtc(+m[3], +m[2], +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  return null;
}

// ---- CSV -----------------------------------------------------------------

const DATE_HEADERS = ["TestDateTime", "TestDateTimes", "TestDatetimes", "Datetimes", "TestDate", "MeasuredDate", "MeasurementDate", "Date", "DateTime"];
const PHONE_HEADERS = ["MobileNumber", "Mobile", "Phone", "PhoneNumber", "TelHP", "UserToken", "Tel"];
const ID_HEADERS = ["ID", "UserID", "MemberID"];
const NAME_HEADERS = ["Name", "UserName", "FullName"];

function pick(row: Record<string, string>, wanted: string[]): string {
  const want = new Set(wanted.map(normKey));
  for (const [k, v] of Object.entries(row)) if (want.has(normKey(k)) && String(v ?? "").trim()) return String(v).trim();
  return "";
}

export interface CsvScan {
  measuredAt: number;
  phone: string;
  userId: string;
  name: string;
  metrics: Metrics;
}

/**
 * Rows of a LookinBody export into scans. A row without a readable date or
 * without a single measurement is skipped and counted, never guessed at.
 */
export function scansFromCsv(headers: string[], rows: string[][]): { scans: CsvScan[]; skipped: number } {
  const scans: CsvScan[] = [];
  let skipped = 0;
  for (const cells of rows) {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    const measuredAt = parseLooseDate(pick(row, DATE_HEADERS));
    const metricCells: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) if (ALIAS_TO_KEY.has(normKey(k))) metricCells[k] = v;
    const metrics = readMetrics(metricCells);
    if (measuredAt === null || !hasMetrics(metrics)) {
      skipped++;
      continue;
    }
    scans.push({ measuredAt, phone: pick(row, PHONE_HEADERS), userId: pick(row, ID_HEADERS), name: pick(row, NAME_HEADERS), metrics });
  }
  return { scans, skipped };
}
