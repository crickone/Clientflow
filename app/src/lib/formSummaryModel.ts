import type { FieldType } from "@/lib/formsModel";

/**
 * A completed form at a glance, for the staff card: how much was answered,
 * the tick-to-confirm lines, and the Yes answers to Yes/No questions (on a
 * health questionnaire those are the ones to read first). Pure.
 */

export interface SummaryAnswer {
  questionId: number;
  label: string;
  fieldType: FieldType;
  value: string;
}

export interface FormSummary {
  questions: number;
  answered: number;
  confirms: { total: number; ticked: number };
  /** Yes/No questions answered Yes. */
  yes: string[];
}

export function summariseForm(answers: SummaryAnswer[]): FormSummary {
  const shown = answers.filter((a) => a.fieldType !== "video");
  const confirms = shown.filter((a) => a.fieldType === "confirm");
  const asks = shown.filter((a) => a.fieldType !== "confirm");
  return {
    questions: asks.length,
    answered: asks.filter((a) => a.value.trim()).length,
    confirms: { total: confirms.length, ticked: confirms.filter((a) => a.value === "yes").length },
    yes: asks.filter((a) => a.fieldType === "dropdown" && /^\s*yes\b/i.test(a.value)).map((a) => a.label),
  };
}
