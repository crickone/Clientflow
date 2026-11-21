/**
 * The platform settings, grouped into the cards the Settings page shows.
 * Pure (no server or client imports) so the page, the client form and the
 * save action share one description of every field, and it can be tested.
 */

/** The saved shape, as the app's /settings returns it and its PUT takes it back. */
export interface PlatformSettings {
  monthlyPriceCents: number;
  vatRateBp: number;
  emailCreditPricePer1000Cents: number;
  emailIncludedPerMonth: number;
  aiCreditMarginBp: number;
  voicePricePerMinuteCents: number;
  voiceIncludedMinutes: number;
  voiceTrialMinutes: number;
  provider: string;
}

type NumericKey = Exclude<keyof PlatformSettings, "provider">;

/** eur and pct are typed in units and saved as hundredths; int is saved as typed. */
export type FieldKind = "eur" | "pct" | "int";

export interface SettingsField {
  /** Form input name. */
  name: string;
  key: NumericKey;
  label: string;
  kind: FieldKind;
  /** Largest value in the typed unit; the app rejects anything above it. */
  max?: number;
  hint?: string;
}

export type CardId = "plan" | "email" | "ai" | "voice";

export interface SettingsCard {
  id: CardId;
  title: string;
  saveLabel: string;
  fields: SettingsField[];
}

export const SETTINGS_CARDS: SettingsCard[] = [
  {
    id: "plan",
    title: "Plan",
    saveLabel: "Save plan",
    fields: [
      { name: "monthlyPrice", key: "monthlyPriceCents", label: "Monthly price (EUR)", kind: "eur" },
      { name: "vatRate", key: "vatRateBp", label: "VAT rate (%)", kind: "pct", max: 100 },
    ],
  },
  {
    id: "email",
    title: "Email",
    saveLabel: "Save email",
    fields: [
      { name: "emailIncluded", key: "emailIncludedPerMonth", label: "Emails included per month", kind: "int", max: 1_000_000,
        hint: "Recipients each business can email every month on the base plan before credits are charged." },
      { name: "emailPrice", key: "emailCreditPricePer1000Cents", label: "Email credit price (EUR / 1000 recipients)", kind: "eur", max: 100 },
    ],
  },
  {
    id: "ai",
    title: "AI",
    saveLabel: "Save AI",
    fields: [
      { name: "aiMargin", key: "aiCreditMarginBp", label: "AI credit margin (%)", kind: "pct", max: 100,
        hint: "Markup over raw model cost, charged on AI usage beyond each business's free monthly allowance." },
    ],
  },
  {
    id: "voice",
    title: "Voice agent add-on",
    saveLabel: "Save voice",
    fields: [
      { name: "voicePrice", key: "voicePricePerMinuteCents", label: "Price per minute (EUR)", kind: "eur", max: 20,
        hint: "Charged on minutes beyond the included allowance. Calls under 20 seconds are never billed." },
      { name: "voiceIncluded", key: "voiceIncludedMinutes", label: "Minutes included per month", kind: "int", max: 100_000 },
      { name: "voiceTrial", key: "voiceTrialMinutes", label: "Free trial minutes", kind: "int", max: 100_000,
        hint: "One-off evaluation minutes while a business's add-on is on trial. They do not reset monthly." },
    ],
  },
];

export function isCardId(v: unknown): v is CardId {
  return SETTINGS_CARDS.some((c) => c.id === v);
}

/** What goes in the input: the saved value in the unit the operator types. */
export function displayValue(field: SettingsField, saved: PlatformSettings): string {
  const n = saved[field.key];
  if (!Number.isFinite(n)) return "";
  return field.kind === "int" ? String(n) : (n / 100).toFixed(2);
}

/**
 * Turn one card's typed values into the saved units, or say what is wrong.
 * Only that card's fields are read, so a card can never touch another's.
 */
export function parseCard(
  cardId: CardId,
  values: Record<string, string>,
): { ok: true; patch: Partial<Record<NumericKey, number>> } | { ok: false; error: string } {
  const card = SETTINGS_CARDS.find((c) => c.id === cardId);
  if (!card) return { ok: false, error: "Unknown settings group." };
  const patch: Partial<Record<NumericKey, number>> = {};
  for (const f of card.fields) {
    const raw = (values[f.name] ?? "").trim();
    const n = raw === "" ? NaN : Number(raw);
    const label = f.label.replace(/ \(.*\)$/, "");
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${label}: enter a number, zero or more.` };
    if (f.kind === "int" && !Number.isInteger(n)) return { ok: false, error: `${label}: enter a whole number.` };
    if (f.max !== undefined && n > f.max) return { ok: false, error: `${label}: enter ${f.max} or less.` };
    patch[f.key] = f.kind === "int" ? n : Math.round(n * 100);
  }
  return { ok: true, patch };
}

/** The full PUT body: the freshly loaded settings with one card's values on top. */
export function mergeForSave(
  current: PlatformSettings,
  patch: Partial<Record<NumericKey, number>>,
): Omit<PlatformSettings, "provider"> {
  return {
    monthlyPriceCents: current.monthlyPriceCents,
    vatRateBp: current.vatRateBp,
    emailCreditPricePer1000Cents: current.emailCreditPricePer1000Cents,
    emailIncludedPerMonth: current.emailIncludedPerMonth,
    aiCreditMarginBp: current.aiCreditMarginBp,
    voicePricePerMinuteCents: current.voicePricePerMinuteCents,
    voiceIncludedMinutes: current.voiceIncludedMinutes,
    voiceTrialMinutes: current.voiceTrialMinutes,
    ...patch,
  };
}
