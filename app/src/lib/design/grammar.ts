/**
 * The layout grammar — what the AI is allowed to emit.
 *
 * ZERO RUNTIME IMPORTS (see ./parse.ts). ChromeIntent is a type-only import,
 * erased at compile time.
 *
 * THE CONSTRAINT IS THE DESIGN. A model that can place arbitrary boxes at
 * arbitrary coordinates will, eventually, place one badly, and there is no
 * check that can tell "unusual" from "wrong". So it cannot position anything.
 * It chooses one of six ARCHETYPES — bounded compositions the renderer knows
 * how to draw — and fills in parameters, every one of which is either a value
 * key from the tenant's own system or a small enum. Everything outside that
 * vocabulary is rejected here, before it reaches a canvas or a database.
 *
 * The archetypes carry their own rules (which photo treatments they permit,
 * how many text slots they hold) because those are properties of the
 * composition, not of any one brand.
 */
import type { ChromeIntent } from "@/lib/image/templates";
import type { DesignSystem, TypeLevel } from "./parse";
import { TYPE_LEVELS, isGround, valueHex } from "./parse";

export type Archetype =
  | "statement"
  | "split"
  | "stack"
  | "list"
  | "quote"
  | "stat";

/** Where a photograph sits, if there is one. "half" belongs to `split` alone;
 *  "none" is the flat-ground slide that costs nothing to generate. */
export type PhotoMode = "full" | "half" | "none";

/**
 * Composition alignment. One member today, on purpose: Optimal Health's
 * document says "flush left, ragged right, always. No centred type, no
 * justification, no italics", and every system authored so far agrees. It is a
 * field rather than an assumption so that a system which does allow centring
 * has somewhere to say so, and so the widening is a one-line change here
 * instead of an archaeology exercise across the renderer.
 */
export type Align = "left";

export interface LayoutSlot {
  level: TypeLevel;
  text: string;
  /** Width in grid columns. */
  span: number;
}

export interface LayoutSpec {
  archetype: Archetype;
  /** A value key from the system, which must be one of its grounds. */
  ground: string;
  photo: PhotoMode;
  /** Which half the photo takes. `split` only. */
  photoSide?: "left" | "right";
  align: Align;
  slots: LayoutSlot[];
  /** The one decorative move the grammar allows: a rule in an accent value,
   *  above or below the text block. Timber exists to divide and to fill. */
  accentRule?: { value: string; place: "above" | "below" };
  chrome?: ChromeIntent;
}

export interface ArchetypeRule {
  archetype: Archetype;
  /** Told to the model as its vocabulary — keep it one line and concrete. */
  blurb: string;
  photo: readonly PhotoMode[];
  slots: { min: number; max: number };
}

/** The whole vocabulary. Adding an archetype means adding a painter for it in
 *  paintLayout, so this table and that renderer are checked against each other
 *  by test rather than by hope. */
export const ARCHETYPES: readonly ArchetypeRule[] = [
  {
    archetype: "statement",
    blurb: "One large line on a full-bleed photograph or a flat ground.",
    photo: ["full", "none"],
    slots: { min: 1, max: 2 },
  },
  {
    archetype: "split",
    blurb: "Photograph on one half, a panel of type on the other.",
    photo: ["half"],
    slots: { min: 1, max: 4 },
  },
  {
    archetype: "stack",
    blurb: "A label, a heading and body copy in one column.",
    photo: ["full", "none"],
    slots: { min: 2, max: 4 },
  },
  {
    archetype: "list",
    blurb: "A heading and three to five short lines.",
    photo: ["none"],
    slots: { min: 4, max: 6 },
  },
  {
    archetype: "quote",
    blurb: "An attributed quotation.",
    photo: ["full", "none"],
    slots: { min: 1, max: 2 },
  },
  {
    archetype: "stat",
    blurb: "One number carrying the slide, with a caption under it.",
    photo: ["full", "none"],
    slots: { min: 1, max: 3 },
  },
] as const;

const RULE_BY_ARCHETYPE: Record<string, ArchetypeRule> = Object.fromEntries(
  ARCHETYPES.map((r) => [r.archetype, r]),
);

export function archetypeRule(a: string): ArchetypeRule | null {
  return RULE_BY_ARCHETYPE[a] ?? null;
}

export interface SpecError {
  error: string;
}

export function isSpecError(v: LayoutSpec | SpecError): v is SpecError {
  return "error" in v;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const LEVELS: ReadonlySet<string> = new Set(TYPE_LEVELS);

/**
 * Parse one slide's layout spec against a specific design system. The system
 * is a parameter, not a global, because "is `sage` a ground?" has no answer
 * without one — the grammar is only ever meaningful relative to a brand.
 *
 * Returns the spec or a single error string. One error, not a list: this is
 * the machine boundary (the model emitted something outside its vocabulary,
 * which is a bug in the prompt or the model), whereas ./validate.ts returns a
 * LIST because those violations are shown to a human who needs to see all of
 * them at once.
 */
export function parseLayoutSpec(
  input: unknown,
  system: DesignSystem,
): LayoutSpec | SpecError {
  if (!isObj(input)) return { error: "Layout spec is not an object" };

  const rule = archetypeRule(String(input.archetype));
  if (!rule) {
    return {
      error: `Unknown archetype "${String(input.archetype)}" — the vocabulary is ${ARCHETYPES.map((r) => r.archetype).join(", ")}`,
    };
  }

  // Ground
  const ground = typeof input.ground === "string" ? input.ground.trim() : "";
  if (!ground || valueHex(system, ground) === null) {
    return { error: `Unknown value "${ground}" for ground` };
  }
  if (!isGround(system, ground)) {
    const allowed = system.grounds.map((g) => g.value).join(", ");
    return {
      error: `"${ground}" is not a ground in this system — the grounds are ${allowed}`,
    };
  }

  // Photo treatment, and the archetype's own rule about it.
  const photo = String(input.photo ?? "none") as PhotoMode;
  if (photo !== "full" && photo !== "half" && photo !== "none") {
    return { error: `Unknown photo treatment "${String(input.photo)}"` };
  }
  if (!rule.photo.includes(photo)) {
    return {
      error: `A ${rule.archetype} slide cannot take a "${photo}" photo — it allows ${rule.photo.join(", ")}`,
    };
  }

  // photoSide belongs to split alone.
  let photoSide: "left" | "right" | undefined;
  if (input.photoSide !== undefined && input.photoSide !== null) {
    if (input.photoSide !== "left" && input.photoSide !== "right") {
      return { error: `Unknown photoSide "${String(input.photoSide)}"` };
    }
    if (rule.archetype !== "split") {
      return {
        error: `photoSide is only meaningful on a split slide, not on a ${rule.archetype}`,
      };
    }
    photoSide = input.photoSide;
  }
  if (rule.archetype === "split" && !photoSide) photoSide = "right";

  // Alignment. Absent means the house default rather than an error — the
  // model should not have to restate a rule that has one legal answer.
  const align = input.align === undefined ? "left" : input.align;
  if (align !== "left") {
    return {
      error: `Unknown alignment "${String(align)}" — this grammar sets type flush left`,
    };
  }

  // Slots
  if (!Array.isArray(input.slots)) return { error: "Layout spec has no slots" };
  if (
    input.slots.length < rule.slots.min ||
    input.slots.length > rule.slots.max
  ) {
    return {
      error: `A ${rule.archetype} slide holds ${rule.slots.min}-${rule.slots.max} text slots, not ${input.slots.length}`,
    };
  }
  const slots: LayoutSlot[] = [];
  for (let i = 0; i < input.slots.length; i++) {
    const raw: unknown = input.slots[i];
    if (!isObj(raw)) return { error: `Slot ${i + 1} is not an object` };
    if (typeof raw.level !== "string" || !LEVELS.has(raw.level)) {
      return {
        error: `Slot ${i + 1} has unknown type level "${String(raw.level)}" — the scale is ${TYPE_LEVELS.join(", ")}`,
      };
    }
    if (typeof raw.text !== "string") {
      return { error: `Slot ${i + 1} has no text` };
    }
    const span = raw.span;
    if (
      typeof span !== "number" ||
      !Number.isInteger(span) ||
      span < 1 ||
      span > system.grid.columns
    ) {
      return {
        error: `Slot ${i + 1} spans ${String(span)} of ${system.grid.columns} columns`,
      };
    }
    slots.push({ level: raw.level as TypeLevel, text: raw.text, span });
  }

  // Accent rule
  let accentRule: LayoutSpec["accentRule"];
  if (input.accentRule !== undefined && input.accentRule !== null) {
    if (!isObj(input.accentRule)) return { error: "accentRule is not an object" };
    const value =
      typeof input.accentRule.value === "string"
        ? input.accentRule.value.trim()
        : "";
    if (!value || valueHex(system, value) === null) {
      return { error: `Unknown value "${value}" for the accent rule` };
    }
    const place = input.accentRule.place;
    if (place !== "above" && place !== "below") {
      return { error: `Unknown accent rule placement "${String(place)}"` };
    }
    accentRule = { value, place };
  }

  const spec: LayoutSpec = {
    archetype: rule.archetype,
    ground,
    photo,
    align: "left",
    slots,
  };
  if (photoSide) spec.photoSide = photoSide;
  if (accentRule) spec.accentRule = accentRule;
  if (isObj(input.chrome)) spec.chrome = input.chrome as ChromeIntent;
  return spec;
}

/** Round-trip a spec through JSON for storage in `carousel_slides.layout_json`. */
export function serializeLayoutSpec(spec: LayoutSpec): string {
  return JSON.stringify(spec);
}

/** Read a stored spec back. Anything unparseable returns an error, never
 *  throws — a corrupt row must surface as a violation, not a crash. */
export function deserializeLayoutSpec(
  json: string | null | undefined,
  system: DesignSystem,
): LayoutSpec | SpecError {
  if (!json) return { error: "This slide has no stored layout" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { error: "This slide's stored layout is not valid JSON" };
  }
  return parseLayoutSpec(parsed, system);
}
