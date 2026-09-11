/**
 * The tenant design system, as data.
 *
 * ZERO RUNTIME IMPORTS, deliberately — this file has to load under the plain
 * tsx test runner (scripts/test.mjs) and inside the pure grammar/validator
 * modules, neither of which can pull in `server-only` or the database. The
 * store accessors that read and write it live in ./system.ts, which can.
 *
 * A design system is the machine-readable form of what a brand document
 * already says in prose: which values exist and what each is for, which of
 * them may carry a ground and how often, the type scale, the grid, the photo
 * grade, and the contrast floors. Optimal Health's "Sage Field" document is
 * the model (see ./presets.ts) — it states its rules as measured numbers,
 * which is exactly what makes AI-composed layout checkable rather than a
 * lottery.
 */

/** What a value is FOR. Note this is the value's primary role, not a
 *  permission list: ink's role is "type" and it is also the anchor ground.
 *  Ground eligibility is answered by the `grounds` array below, which is the
 *  authoritative list, because only that carries the share and run budgets. */
export type ValueRole = "ground" | "type" | "accent" | "reserved";

/** The type scale's levels, coarsest first. Fixed set: a system that needs a
 *  sixth level is a system that has stopped being a system. */
export const TYPE_LEVELS = [
  "display",
  "headline",
  "subhead",
  "body",
  "label",
] as const;
export type TypeLevel = (typeof TYPE_LEVELS)[number];

/** Levels large enough to be held to the LARGE-text contrast floor rather
 *  than the body floor — WCAG's own distinction, and the reason a system can
 *  allow deep green on sage (3.62:1) for a headline but not for body copy. */
export const LARGE_TYPE_LEVELS: ReadonlySet<TypeLevel> = new Set([
  "display",
  "headline",
]);

export interface TypeStep {
  /** px, authored against `grid.field` and scaled proportionally to the real
   *  slide width, so one system serves 1:1, 4:5 and 9:16. */
  size: number;
  /** Line height as a multiple of `size`. */
  leading: number;
  /** Letter spacing in em. Negative tightens. */
  tracking: number;
  weight: number;
  upper?: boolean;
}

/** The face a system renders in when it names none. Inter is what every
 *  system authored before `font` existed rendered in, so defaulting to it is
 *  what keeps those stored blobs meaning what they meant. */
export const DEFAULT_DESIGN_FONT = "Inter";

export interface DesignSystem {
  version: 1;
  /** satori font family. Must be one the renderer has bytes for
   *  (lib/design/fonts.ts AVAILABLE_FAMILIES); an unknown name falls back to
   *  Inter at load time rather than rendering in a silent default. */
  font: string;
  /**
   * A SECOND display face, where a style genuinely has two -- a serif for
   * editorial pages and a condensed grotesk for posters, say. Absent means the
   * style has one display face, which is the common case.
   */
  altFont?: string;
  /** The face for body and small copy. Absent means "the same as `font`" --
   *  which is what every system authored before the pair existed meant. A
   *  serif display over a sans body is the move that makes an editorial system
   *  read as editorial rather than as one face at two sizes. */
  bodyFont?: string;
  /**
   * This system's own compositional vocabulary: the moves that make its posts
   * look like ITS posts. Fed to the designer in place of the generic list.
   *
   * This is the field that stops two systems with different palettes producing
   * the same layouts -- everything else here is colour, size and spacing, none
   * of which is a composition. Empty means "use the generic moves", which is
   * what every system authored before this existed gets.
   */
  motifs: string[];
  /** The named slide types this style is built from. See DesignDirection.templates. */
  templates: { name: string; structure: string }[];
  values: { key: string; hex: string; role: ValueRole }[];
  /** Which values may be a ground, and the budget for each across a set.
   *  `share` is a ceiling as a fraction of the slides (0..1); `maxRun` is how
   *  many consecutive slides may carry it. Sage's maxRun of 1 is the
   *  document's "never on two consecutive slides", stated as a number. */
  grounds: { value: string; share: number; maxRun: number }[];
  type: Record<TypeLevel, TypeStep>;
  grid: { columns: number; margin: number; gutter: number; field: number };
  /** Photo grade. Multipliers on the source (1 = unchanged). null = this
   *  system does not grade photography. */
  photo: {
    saturate: number;
    contrast: number;
    brightness: number;
    wash?: { hex: string; alpha: number };
  } | null;
  rules: {
    minContrastBody: number;
    minContrastLarge: number;
    /** Value keys that must never carry text, whatever the contrast maths
     *  says. Optimal Health's timber is the case this exists for: it is the
     *  prettiest value in the palette, it will be reached for constantly, and
     *  it fails as type on every ground. */
    neverType: string[];
  };
}

// -------------------------------------------------------------------------
//  Parsing
// -------------------------------------------------------------------------

const HEX = /^#[0-9a-fA-F]{6}$/;
const ROLES: ReadonlySet<string> = new Set([
  "ground",
  "type",
  "accent",
  "reserved",
]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : null;
}

function parseTypeStep(v: unknown): TypeStep | null {
  if (!isObj(v)) return null;
  const size = num(v.size, 1, 1000);
  const leading = num(v.leading, 0.5, 4);
  const tracking = num(v.tracking, -0.5, 1);
  const weight = num(v.weight, 1, 1000);
  if (size === null || leading === null || tracking === null || weight === null) {
    return null;
  }
  const step: TypeStep = { size, leading, tracking, weight };
  if (v.upper === true) step.upper = true;
  return step;
}

/**
 * Tolerant parse of a stored design system. Returns null rather than throwing
 * on ANY malformed input — a tenant whose stored blob is junk, half-migrated
 * or from a future version must fall through to today's behaviour, not break
 * their Content Studio. Null is a first-class state throughout this feature.
 */
export function parseDesignSystem(input: unknown): DesignSystem | null {
  if (!isObj(input)) return null;
  if (input.version !== 1) return null;

  // Values
  if (!Array.isArray(input.values) || input.values.length === 0) return null;
  const values: DesignSystem["values"] = [];
  const seen = new Set<string>();
  for (const raw of input.values) {
    if (!isObj(raw)) return null;
    const key = typeof raw.key === "string" ? raw.key.trim() : "";
    const hex = typeof raw.hex === "string" ? raw.hex.trim() : "";
    const role = typeof raw.role === "string" ? raw.role : "";
    if (!key || seen.has(key)) return null;
    if (!HEX.test(hex)) return null;
    if (!ROLES.has(role)) return null;
    seen.add(key);
    values.push({ key, hex: hex.toLowerCase(), role: role as ValueRole });
  }

  // Grounds — every one must name a value that exists.
  if (!Array.isArray(input.grounds) || input.grounds.length === 0) return null;
  const grounds: DesignSystem["grounds"] = [];
  const groundKeys = new Set<string>();
  for (const raw of input.grounds) {
    if (!isObj(raw)) return null;
    const value = typeof raw.value === "string" ? raw.value.trim() : "";
    const share = num(raw.share, 0, 1);
    const maxRun = num(raw.maxRun, 1, 999);
    if (!value || !seen.has(value) || groundKeys.has(value)) return null;
    if (share === null || maxRun === null || !Number.isInteger(maxRun)) {
      return null;
    }
    groundKeys.add(value);
    grounds.push({ value, share, maxRun });
  }

  // Type scale — every level required, so no render can hit a missing step.
  if (!isObj(input.type)) return null;
  const type = {} as DesignSystem["type"];
  for (const level of TYPE_LEVELS) {
    const step = parseTypeStep(input.type[level]);
    if (!step) return null;
    type[level] = step;
  }

  // Grid
  if (!isObj(input.grid)) return null;
  const columns = num(input.grid.columns, 1, 24);
  const margin = num(input.grid.margin, 0, 1000);
  const gutter = num(input.grid.gutter, 0, 1000);
  const field = num(input.grid.field, 1, 10000);
  if (
    columns === null ||
    !Number.isInteger(columns) ||
    margin === null ||
    gutter === null ||
    field === null
  ) {
    return null;
  }
  // The columns have to actually fit the field, or every span computed from
  // this grid is nonsense.
  if (margin * 2 + gutter * (columns - 1) >= field) return null;

  // Photo grade — explicitly nullable.
  let photo: DesignSystem["photo"] = null;
  if (input.photo !== null && input.photo !== undefined) {
    if (!isObj(input.photo)) return null;
    const saturate = num(input.photo.saturate, 0, 4);
    const contrast = num(input.photo.contrast, 0, 4);
    const brightness = num(input.photo.brightness, 0, 4);
    if (saturate === null || contrast === null || brightness === null) {
      return null;
    }
    photo = { saturate, contrast, brightness };
    if (input.photo.wash !== null && input.photo.wash !== undefined) {
      if (!isObj(input.photo.wash)) return null;
      const hex =
        typeof input.photo.wash.hex === "string"
          ? input.photo.wash.hex.trim()
          : "";
      const alpha = num(input.photo.wash.alpha, 0, 1);
      if (!HEX.test(hex) || alpha === null) return null;
      photo.wash = { hex: hex.toLowerCase(), alpha };
    }
  }

  // Rules
  if (!isObj(input.rules)) return null;
  const minContrastBody = num(input.rules.minContrastBody, 1, 21);
  const minContrastLarge = num(input.rules.minContrastLarge, 1, 21);
  if (minContrastBody === null || minContrastLarge === null) return null;
  const neverTypeRaw = input.rules.neverType ?? [];
  if (!Array.isArray(neverTypeRaw)) return null;
  const neverType: string[] = [];
  for (const key of neverTypeRaw) {
    if (typeof key !== "string" || !seen.has(key)) return null;
    neverType.push(key);
  }

  // Optional faces -- absent means the system does not have that role, which
  // for bodyFont means "the same face as the display".
  const optionalFace = (v: unknown): { ok: true; value?: string } | { ok: false } => {
    if (v === undefined) return { ok: true };
    if (typeof v === "string" && v.trim()) return { ok: true, value: v.trim() };
    return { ok: false };
  };
  const bodyParsed = optionalFace(input.bodyFont);
  if (!bodyParsed.ok) return null;
  const bodyFont = bodyParsed.value;
  const altParsed = optionalFace(input.altFont);
  if (!altParsed.ok) return null;
  const altFont = altParsed.value;

  // Motifs — absent is an empty list, i.e. "use the generic moves". Each entry
  // must be a non-empty string; anything else is malformed, same as any field.
  let motifs: string[] = [];
  if (input.motifs !== undefined) {
    if (!Array.isArray(input.motifs)) return null;
    for (const m of input.motifs) {
      if (typeof m !== "string" || !m.trim()) return null;
      motifs.push(m.trim());
    }
  }

  // Templates — absent is an empty list. Each needs both halves: a name with
  // no structure tells the designer nothing, and a structure with no name
  // cannot be referred to when asking for a different one next slide.
  const templates: { name: string; structure: string }[] = [];
  if (input.templates !== undefined) {
    if (!Array.isArray(input.templates)) return null;
    for (const t of input.templates) {
      if (!isObj(t)) return null;
      const name = typeof t.name === "string" ? t.name.trim() : "";
      const structure = typeof t.structure === "string" ? t.structure.trim() : "";
      if (!name || !structure) return null;
      templates.push({ name, structure });
    }
  }

  // Font — absent means "authored before fonts existed", which is Inter.
  // Present but not a usable string is malformed, same as any other field.
  let font: string;
  if (input.font === undefined) {
    font = DEFAULT_DESIGN_FONT;
  } else if (typeof input.font === "string" && input.font.trim()) {
    font = input.font.trim();
  } else {
    return null;
  }

  return {
    version: 1,
    font,
    ...(bodyFont ? { bodyFont } : {}),
    ...(altFont ? { altFont } : {}),
    motifs,
    templates,
    values,
    grounds,
    type,
    grid: { columns, margin, gutter, field },
    photo,
    rules: { minContrastBody, minContrastLarge, neverType },
  };
}

// -------------------------------------------------------------------------
//  Lookups
// -------------------------------------------------------------------------

/** Hex for a value key, or null if the system has no such value. */
export function valueHex(system: DesignSystem, key: string): string | null {
  return system.values.find((v) => v.key === key)?.hex ?? null;
}

/** Whether a value may be used as a ground in this system. Answered by the
 *  `grounds` budget list, not by `role` — see the note on ValueRole. */
export function isGround(system: DesignSystem, key: string): boolean {
  return system.grounds.some((g) => g.value === key);
}

/** Column width in the system's own authored units. */
export function columnWidth(system: DesignSystem): number {
  const { field, margin, gutter, columns } = system.grid;
  return (field - margin * 2 - gutter * (columns - 1)) / columns;
}

/** Scale factor from the system's authored field to a real slide width, so
 *  one system serves every aspect ratio. */
export function fieldScale(system: DesignSystem, width: number): number {
  return width / system.grid.field;
}
