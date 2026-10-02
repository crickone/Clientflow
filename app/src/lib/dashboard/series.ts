const DAY = 86_400_000;

/** Zero-fill a sparse day series across `days` days starting at `fromIso`. */
export function fillDays(rows: { day: string; total: number }[], fromIso: string, days: number) {
  const map = new Map(rows.map((r) => [r.day, Number(r.total) || 0]));
  const start = Date.parse(`${fromIso}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(start + i * DAY).toISOString().slice(0, 10);
    return { day, total: map.get(day) ?? 0 };
  });
}
