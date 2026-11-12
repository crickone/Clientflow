/**
 * Round tick values covering [min(0, min), max(0, max)] in about `count` steps
 * (1, 2, 2.5, 5 x 10^n). Always includes 0 and spans both ends. Non-finite
 * input or an empty range gives [0].
 */
export function niceRange(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  const lo0 = Math.min(0, min);
  const hi0 = Math.max(0, max);
  const span = hi0 - lo0;
  if (span <= 0) return [0];
  const rough = span / Math.max(1, count);
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow * 10;
  const first = Math.floor(lo0 / step + 1e-9);
  const last = Math.ceil(hi0 / step - 1e-9);
  const ticks: number[] = [];
  for (let i = first; i <= last; i++) {
    const v = Number((i * step).toPrecision(12));
    if (!ticks.includes(v)) ticks.push(v);
  }
  return ticks.length ? ticks : [0];
}

/** Round tick values that cover [0, max] in about `count` steps. */
export function niceTicks(max: number, count = 4): number[] {
  return niceRange(0, max, count);
}

/** Linear 0..domainMax to 0..range. A zero domain maps everything to 0. */
export function scale(domainMax: number, range: number): (v: number) => number {
  if (!Number.isFinite(domainMax) || domainMax <= 0) return () => 0;
  return (v) => (v / domainMax) * range;
}

/** Linear domainMin..domainMax to 0..range (domainMin maps to 0). A flat or invalid domain maps to 0. */
export function scaleDomain(domainMin: number, domainMax: number, range: number): (v: number) => number {
  const span = domainMax - domainMin;
  if (!Number.isFinite(span) || span <= 0) return () => 0;
  return (v) => ((v - domainMin) / span) * range;
}
