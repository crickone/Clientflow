/**
 * Reading the photo picker's answer (./pickAdPhotos). Pure, so it is tested
 * without a model.
 *
 * Returns, per version, the 0-based index of the chosen candidate or null for
 * "no photo fits". Out-of-range numbers, 0 and missing versions are null.
 */
export function readPicks(text: string, versions: number, candidates: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: versions }, () => null);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return out;
  }
  const picks = (parsed as { picks?: unknown }).picks;
  if (!Array.isArray(picks)) return out;
  for (const p of picks) {
    const o = (p ?? {}) as { version?: unknown; photo?: unknown };
    const v = Number(o.version);
    const n = Number(o.photo);
    if (!Number.isInteger(v) || v < 1 || v > versions) continue;
    if (!Number.isInteger(n) || n < 1 || n > candidates) continue;
    out[v - 1] = n - 1;
  }
  return out;
}

/**
 * The photographs to hand the design engine, and whether to generate.
 *
 * The engine gives slide i the i-th photograph, so a full set of picks is
 * passed in version order and nothing is generated. If any version has no
 * fitting photograph and a generator is available, every version is
 * generated instead: the engine's generator wins over the library for every
 * slot, and a set half real, half generated would not hold together. With no
 * generator, the gaps are filled with the picks that did fit.
 */
export function planAdPhotos<T>(picks: (T | null)[], canGenerate: boolean): { photos: T[]; generate: boolean } {
  const found = picks.filter((p): p is T => p !== null);
  if (found.length === picks.length && found.length > 0) return { photos: found, generate: false };
  if (canGenerate) return { photos: found, generate: true };
  if (found.length === 0) return { photos: [], generate: false };
  return { photos: picks.map((p, i) => p ?? found[i % found.length]), generate: false };
}
