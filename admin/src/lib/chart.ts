/** Round tick values that cover [0, max] in about `count` steps: 1, 2, 2.5, 5 x 10^n. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const rough = max / count;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow * 10;
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

/** Linear 0..domainMax to 0..range. A zero domain maps everything to 0. */
export function scale(domainMax: number, range: number): (v: number) => number {
  if (domainMax <= 0) return () => 0;
  return (v) => (v / domainMax) * range;
}
