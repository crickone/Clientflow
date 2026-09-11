/**
 * A design DIRECTION is a design system with the hexes taken out.
 *
 * Everything that makes "Sage Field" feel like Sage Field -- its typeface, its
 * type scale, its grid, how often each ground may appear, its photo grade, its
 * contrast floors -- is structural, and none of it is a colour. The colours
 * are the one part that has to be the tenant's own, or every client on the
 * same direction looks identical, which is the templated look the composed
 * post work exists to escape, moved up a level from layout to brand.
 *
 * So a direction declares named palette SLOTS, each with a role and a default,
 * and the tenant supplies a hex per slot. `composeDesignSystem` fills the
 * slots and returns an ordinary DesignSystem -- the thing the prompt, the
 * audit and the renderer already read. Nothing downstream knows directions
 * exist.
 *
 * ZERO RUNTIME IMPORTS beyond the sibling pure modules (see ./parse.ts): this
 * runs in the pure test runner and in the browser.
 */
import { TYPE_LEVELS, type DesignSystem, type TypeLevel, type TypeStep, type ValueRole } from "./parse";
import { contrastRatio } from "./validate";

export interface PaletteSlot {
  /** Becomes the value key in the composed system. */
  key: string;
  /** Shown to the operator beside the swatch. Says what the slot is FOR. */
  label: string;
  role: ValueRole;
  /** The hex used until the tenant chooses one -- the direction's own look. */
  defaultHex: string;
  /** Present on slots that may be a slide's background, with the budget. */
  ground?: { share: number; maxRun: number };
}

export interface DesignDirection {
  id: string;
  name: string;
  /** One sentence for the picker. */
  blurb: string;
  /** Must be a family in lib/design/fonts.ts AVAILABLE_FAMILIES. */
  font: string;
  /** The face for body and small copy. Omitted means the same as `font`. */
  bodyFont?: string;
  /** A second display face, where the style genuinely has two. */
  altFont?: string;
  /**
   * This direction's own compositional moves -- what makes its posts look like
   * ITS posts rather than another direction's palette. Empty means the
   * designer gets the generic list instead.
   */
  motifs: string[];
  /**
   * The named slide types this style is built from. A carousel in this style is
   * a sequence of these, a different one per slide, rather than one shape five
   * times.
   *
   * These are DESCRIBED, not filled in. An earlier version of this codebase
   * shipped an archetype grammar that handed the model a layout to populate,
   * and it produced exactly the templated look composed design exists to
   * escape. A template here names a structure and its parts; the model still
   * decides the proportions, the crop and the emphasis. The difference is the
   * difference between a stencil and a brief.
   */
  templates?: { name: string; structure: string }[];
  slots: PaletteSlot[];
  type: Record<TypeLevel, TypeStep>;
  grid: DesignSystem["grid"];
  photo: {
    saturate: number;
    contrast: number;
    brightness: number;
    /** A wash in a SLOT's colour, resolved to that tenant's hex at compose time. */
    wash?: { slot: string; alpha: number };
  } | null;
  rules: {
    minContrastBody: number;
    minContrastLarge: number;
    /** Slot keys forbidden as type whatever the maths says. The derived list
     *  (see deriveNeverType) is added on top of this, never instead of it. */
    neverType: string[];
  };
}

/** Slot key -> hex. What the tenant chose. */
export type BrandPalette = Record<string, string>;

/** The direction's own look: every slot at its default. */
export function defaultPalette(direction: DesignDirection): BrandPalette {
  const out: BrandPalette = {};
  for (const s of direction.slots) out[s.key] = s.defaultHex.toLowerCase();
  return out;
}

/**
 * Values that cannot be read on ANY ground: below the large-text floor
 * against every one. A colour like that is not a type colour whatever the
 * author intended, and finding it by arithmetic is what lets a tenant swap in
 * a palette without a designer re-checking every pairing by hand.
 *
 * Reserved values are skipped: they are never type by definition and listing
 * them would be noise.
 */
export function deriveNeverType(
  values: { key: string; hex: string; role: ValueRole }[],
  groundHexes: string[],
  minContrastLarge: number,
): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v.role === "reserved") continue;
    const readableSomewhere = groundHexes.some((g) => {
      const r = contrastRatio(v.hex, g);
      return !Number.isNaN(r) && r >= minContrastLarge;
    });
    if (!readableSomewhere) out.push(v.key);
  }
  return out;
}

/**
 * Fill a direction's slots with a palette and return the DesignSystem.
 *
 * Any slot the palette does not name takes the direction's default, so a
 * partial palette is always a complete system. Hexes are lower-cased to
 * match what the parser stores.
 */
export function composeDesignSystem(
  direction: DesignDirection,
  palette: BrandPalette,
): DesignSystem {
  const hexFor = (slot: PaletteSlot): string =>
    (palette[slot.key] ?? slot.defaultHex).trim().toLowerCase();

  const values = direction.slots.map((s) => ({ key: s.key, hex: hexFor(s), role: s.role }));
  const grounds = direction.slots
    .filter((s) => s.ground)
    .map((s) => ({ value: s.key, share: s.ground!.share, maxRun: s.ground!.maxRun }));
  const groundHexes = grounds.map((g) => values.find((v) => v.key === g.value)!.hex);

  let photo: DesignSystem["photo"] = null;
  if (direction.photo) {
    photo = {
      saturate: direction.photo.saturate,
      contrast: direction.photo.contrast,
      brightness: direction.photo.brightness,
    };
    if (direction.photo.wash) {
      const slot = direction.slots.find((s) => s.key === direction.photo!.wash!.slot);
      if (slot) photo.wash = { hex: hexFor(slot), alpha: direction.photo.wash.alpha };
    }
  }

  const derived = deriveNeverType(values, groundHexes, direction.rules.minContrastLarge);
  const neverType = [...direction.rules.neverType];
  for (const key of derived) if (!neverType.includes(key)) neverType.push(key);

  return {
    version: 1,
    font: direction.font,
    ...(direction.bodyFont ? { bodyFont: direction.bodyFont } : {}),
    ...(direction.altFont ? { altFont: direction.altFont } : {}),
    motifs: [...direction.motifs],
    templates: (direction.templates ?? []).map((t) => ({ ...t })),
    values,
    grounds,
    type: direction.type,
    grid: direction.grid,
    photo,
    rules: {
      minContrastBody: direction.rules.minContrastBody,
      minContrastLarge: direction.rules.minContrastLarge,
      neverType,
    },
  };
}

// ─── Overrides: the operator's edits on top of a direction ───────────────────

/**
 * What an operator may change about a direction without leaving it: the
 * typeface, the type scale, and the photo grade. NOT the grid and NOT the
 * ground rotation budgets -- those are the questions nobody can answer in a
 * settings form ("how many consecutive slides may carry sage?"), and they are
 * what makes a direction a direction rather than a blank form.
 *
 * Stored beside the choice, applied at compose time, so the direction itself
 * is never mutated and "Direction's own type" is always one reset away.
 */
export interface DirectionOverrides {
  /** Must be a family the renderer has; validated against the list the caller passes. */
  font?: string;
  /** The body face, same validation as `font`. */
  bodyFont?: string;
  /** Per level, any subset of the step's fields. */
  type?: Partial<Record<TypeLevel, Partial<TypeStep>>>;
  /** A whole grade, or null for "no photo grade". The direction's wash (a slot
   *  reference) is kept when a grade is given -- it is structural, not a number. */
  photo?: { saturate: number; contrast: number; brightness: number } | null;
}

function inRange(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

/**
 * Clamp untrusted overrides to what the parser will accept, dropping anything
 * unusable rather than refusing the lot -- a stored blob with one bad field
 * still yields the good ones. Bounds mirror parseDesignSystem exactly, so an
 * override that survives here composes to a system that parses.
 */
export function normalizeOverrides(raw: unknown, fonts: readonly string[]): DirectionOverrides {
  const out: DirectionOverrides = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;

  if (typeof o.font === "string" && fonts.includes(o.font.trim())) out.font = o.font.trim();
  if (typeof o.bodyFont === "string" && fonts.includes(o.bodyFont.trim())) out.bodyFont = o.bodyFont.trim();

  if (o.type && typeof o.type === "object" && !Array.isArray(o.type)) {
    const type: DirectionOverrides["type"] = {};
    for (const level of TYPE_LEVELS) {
      const step = (o.type as Record<string, unknown>)[level];
      if (!step || typeof step !== "object" || Array.isArray(step)) continue;
      const st = step as Record<string, unknown>;
      const partial: Partial<TypeStep> = {};
      const size = inRange(st.size, 1, 1000);
      const leading = inRange(st.leading, 0.5, 4);
      const tracking = inRange(st.tracking, -0.5, 1);
      const weight = inRange(st.weight, 1, 1000);
      if (size !== null) partial.size = size;
      if (leading !== null) partial.leading = leading;
      if (tracking !== null) partial.tracking = tracking;
      if (weight !== null) partial.weight = weight;
      if (typeof st.upper === "boolean") partial.upper = st.upper;
      if (Object.keys(partial).length > 0) type[level] = partial;
    }
    if (Object.keys(type).length > 0) out.type = type;
  }

  if (o.photo === null) {
    out.photo = null;
  } else if (o.photo && typeof o.photo === "object" && !Array.isArray(o.photo)) {
    const ph = o.photo as Record<string, unknown>;
    const saturate = inRange(ph.saturate, 0, 4);
    const contrast = inRange(ph.contrast, 0, 4);
    const brightness = inRange(ph.brightness, 0, 4);
    if (saturate !== null && contrast !== null && brightness !== null) {
      out.photo = { saturate, contrast, brightness };
    }
  }

  return out;
}

/**
 * A direction with an operator's overrides applied. Returns a NEW direction;
 * the authored one is never touched. `upper: false` removes the flag rather
 * than storing a false, so the composed step matches what the parser emits.
 */
export function withOverrides(direction: DesignDirection, overrides: DirectionOverrides): DesignDirection {
  const type = { ...direction.type };
  for (const level of TYPE_LEVELS) {
    const patch = overrides.type?.[level];
    if (!patch) continue;
    const merged: TypeStep = { ...direction.type[level], ...patch };
    if (merged.upper !== true) delete merged.upper;
    type[level] = merged;
  }

  let photo = direction.photo;
  if (overrides.photo === null) {
    photo = null;
  } else if (overrides.photo) {
    photo = { ...overrides.photo, ...(direction.photo?.wash ? { wash: direction.photo.wash } : {}) };
  }

  return {
    ...direction,
    font: overrides.font ?? direction.font,
    bodyFont: overrides.bodyFont ?? direction.bodyFont,
    altFont: direction.altFont,
    type,
    photo,
  };
}
