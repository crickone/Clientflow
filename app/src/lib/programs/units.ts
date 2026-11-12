// app/src/lib/programs/units.ts
/**
 * Weights for the program library. Pure. Everything is stored in kg; the
 * member chooses kg or lb for display, and every working weight rounds to
 * their smallest jump.
 */
import { estimatedMax, parseWeight } from "@/lib/workoutLogModel";
import type { WeightUnit } from "./types";

export const LB_TO_KG = 0.45359237;
/** 5 lb, the smallest jump for a member who lifts in pounds, kept in kg. */
export const STEP_5LB_KG = 2.26796;

export type StepKey = "2.5kg" | "1.25kg" | "5lb";
export const STEP_OPTIONS: { key: StepKey; label: string; kg: number; unit: WeightUnit }[] = [
  { key: "2.5kg", label: "2.5 kg", kg: 2.5, unit: "kg" },
  { key: "1.25kg", label: "1.25 kg (small plates)", kg: 1.25, unit: "kg" },
  { key: "5lb", label: "5 lb", kg: STEP_5LB_KG, unit: "lb" },
];

export function stepFromKey(key: StepKey): number {
  return STEP_OPTIONS.find((s) => s.key === key)?.kg ?? 2.5;
}

export function keyFromStep(kg: number): StepKey {
  return STEP_OPTIONS.find((s) => Math.abs(s.kg - kg) < 1e-3)?.key ?? "2.5kg";
}

/**
 * The smallest jump weights are shown with, for the unit on screen: 5 lb in
 * pounds; in kg the member's own step, or 2.5 kg when that step is 5 lb (or unset).
 */
export function shownStepKg(unit: WeightUnit, stepKg: number): number {
  if (unit === "lb") return STEP_5LB_KG;
  if (!(stepKg > 0) || Math.abs(stepKg - STEP_5LB_KG) < 1e-3) return 2.5;
  return stepKg;
}

/** The nearest multiple of the smallest jump (half rounds up). */
export function roundToStep(kg: number, stepKg: number): number {
  if (!Number.isFinite(kg)) return 0;
  if (!(stepKg > 0)) return Math.round(kg * 100) / 100;
  return Number((Math.round(kg / stepKg + 1e-9) * stepKg).toFixed(3));
}

export function kgToUnit(kg: number, unit: WeightUnit): number {
  return unit === "lb" ? Math.round((kg / LB_TO_KG) * 10) / 10 : Math.round(kg * 100) / 100;
}

export function unitToKg(value: number, unit: WeightUnit): number {
  return Math.round((unit === "lb" ? value * LB_TO_KG : value) * 1000) / 1000;
}

export function formatWeight(kg: number, unit: WeightUnit): string {
  return `${kgToUnit(kg, unit)} ${unit}`;
}

/** A typed weight in the member's unit, to kg. Blank or nonsense is null. */
export function parseWeightIn(raw: string, unit: WeightUnit): number | null {
  if (unit === "kg") return parseWeight(raw);
  const s = raw.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 2200) return null;
  return unitToKg(Math.round(n * 10) / 10, "lb");
}

/** A weight typed in one unit, written in another to one decimal, for a unit switch on a form. Blank, zero or nonsense stays as typed. */
export function convertTyped(raw: string, from: WeightUnit, to: WeightUnit): string {
  if (from === to) return raw;
  const kg = parseWeightIn(raw, from);
  if (kg === null || kg <= 0) return raw;
  const value = to === "lb" ? kg / LB_TO_KG : kg;
  return String(Math.round(value * 10) / 10);
}

/** RPE 1 to 10, to the nearest half. Blank or out of range is null. */
export function parseRpe(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  return Math.round(n * 2) / 2;
}

export function formatSetIn(s: { weightKg: number | null; reps: number | null }, unit: WeightUnit): string {
  if (s.weightKg !== null && s.weightKg > 0 && s.reps !== null) return `${formatWeight(s.weightKg, unit)} x ${s.reps}`;
  if (s.reps !== null) return `${s.reps} reps`;
  if (s.weightKg !== null && s.weightKg > 0) return formatWeight(s.weightKg, unit);
  return "Done";
}

/** Sets above this many reps do not estimate a max. */
export const MAX_SET_REPS = 10;

/** Estimated 1-rep max from a set (Epley), only for sets of 1 to 10 reps. */
export function maxFromSet(kg: number, reps: number): number | null {
  if (!Number.isFinite(kg) || kg <= 0 || !Number.isInteger(reps) || reps < 1 || reps > MAX_SET_REPS) return null;
  return Math.round(estimatedMax(kg, reps) * 100) / 100;
}

export type MaxInput = { kind: "one_rm"; kg: number } | { kind: "set"; kg: number; reps: number };

export function resolveMax(input: MaxInput): number | null {
  if (input.kind === "one_rm") return Number.isFinite(input.kg) && input.kg > 0 ? Math.round(input.kg * 100) / 100 : null;
  return maxFromSet(input.kg, input.reps);
}

export function trainingMax(max: number, tmPct: number): number {
  return Math.round(max * tmPct * 100) / 100;
}

/** The weight for `reps` at a target RPE: Epley backwards, counting reps in reserve as reps. */
export function weightForRpe(e1rm: number, reps: number, rpe: number): number {
  const eff = reps + Math.max(0, 10 - rpe);
  return eff <= 1 ? e1rm : e1rm / (1 + eff / 30);
}
