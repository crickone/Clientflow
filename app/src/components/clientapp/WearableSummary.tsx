import { average, sleepLabel, type WearableDay } from "@/lib/wearables/model";

/**
 * The last seven days from the member's watch or ring: averages up top,
 * steps and sleep as bars. No hooks, so the client app and the staff page
 * both render it.
 */
export function WearableSummary({ days, today }: { days: WearableDay[]; today: string }) {
  const week = lastSeven(today).map((d) => days.find((x) => x.day === d) ?? { day: d });
  const tiles: { label: string; value: string }[] = [];
  const steps = average(week, "steps");
  const sleep = average(week, "sleepMinutes");
  const rhr = average(week, "restingHr");
  const hrv = average(week, "hrvMs");
  const ready = average(week, "readiness");
  const weight = [...days].reverse().find((d) => d.weightKg !== undefined)?.weightKg;
  if (steps !== null) tiles.push({ label: "Steps a day", value: Math.round(steps).toLocaleString("en-IE") });
  if (sleep !== null) tiles.push({ label: "Sleep a night", value: sleepLabel(sleep) });
  if (rhr !== null) tiles.push({ label: "Resting heart rate", value: `${Math.round(rhr)} bpm` });
  if (hrv !== null) tiles.push({ label: "HRV", value: `${Math.round(hrv)} ms` });
  if (ready !== null) tiles.push({ label: "Readiness", value: `${Math.round(ready)}` });
  if (weight !== undefined) tiles.push({ label: "Latest weight", value: `${weight} kg` });

  const maxSteps = Math.max(1, ...week.map((d) => d.steps ?? 0));
  const maxSleep = Math.max(1, ...week.map((d) => d.sleepMinutes ?? 0));
  const dow = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "narrow", timeZone: "UTC" });

  if (tiles.length === 0) return <p className="wsum-empty">Nothing in from your device yet. It updates every hour.</p>;
  return (
    <div className="wsum">
      <div className="wsum-tiles">
        {tiles.map((t) => (
          <div key={t.label}>
            <span>{t.label}</span>
            <b>{t.value}</b>
          </div>
        ))}
      </div>
      {steps !== null && (
        <Bars label="Steps" week={week.map((d) => ({ day: d.day, v: d.steps, text: d.steps?.toLocaleString("en-IE") }))} max={maxSteps} dow={dow} />
      )}
      {sleep !== null && <Bars label="Sleep" week={week.map((d) => ({ day: d.day, v: d.sleepMinutes, text: d.sleepMinutes ? sleepLabel(d.sleepMinutes) : undefined }))} max={maxSleep} dow={dow} />}
      <span className="wsum-note">Averages over the last 7 days</span>
    </div>
  );
}

function Bars({ label, week, max, dow }: { label: string; week: { day: string; v?: number; text?: string }[]; max: number; dow: (d: string) => string }) {
  return (
    <div className="wsum-bars" role="img" aria-label={`${label} each day this week`}>
      <span className="wsum-barlabel">{label}</span>
      <div className="wsum-cols">
        {week.map((d) => (
          <div key={d.day} title={d.text ? `${d.day}: ${d.text}` : d.day}>
            <span className="wsum-bar">
              <span style={{ height: `${d.v ? Math.max(6, (d.v / max) * 100) : 0}%` }} />
            </span>
            <span className="wsum-dow">{dow(d.day)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function lastSeven(today: string): string[] {
  const t = Date.parse(`${today}T12:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => new Date(t - (6 - i) * 86_400_000).toISOString().slice(0, 10));
}
