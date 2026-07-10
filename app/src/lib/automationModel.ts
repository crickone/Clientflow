// Pure automations model — the fixed trigger catalog + message types.

export type Channel = "email" | "push" | "chat";
export type IntervalUnit = "minutes" | "hours" | "days";

export interface TriggerDef {
  key: string;
  label: string;
  description: string;
}

/** Fixed catalog of event triggers (Kahunas "Trigger List"). */
export const TRIGGER_CATALOG: TriggerDef[] = [
  { key: "new_client_created", label: "New client created", description: "When a new client is added to your roster." },
  { key: "client_check_in", label: "Client completes a check-in", description: "When a client submits a check-in." },
  { key: "nutrition_plan_added", label: "Nutrition plan added to your client", description: "When a nutrition plan is assigned to a client." },
  { key: "initial_qa_form", label: "Client completes initial Q&A form", description: "When a client completes their onboarding form." },
  { key: "workout_plan_added", label: "Workout plan added to your client", description: "When a workout program is assigned to a client." },
  { key: "supplement_plan_added", label: "Supplement plan added to your client", description: "When a supplement plan is assigned to a client." },
  { key: "workout_plan_updated", label: "Workout plan updated", description: "When a client's workout program changes." },
  { key: "nutrition_plan_updated", label: "Nutrition plan updated", description: "When a client's nutrition plan changes." },
  { key: "client_missed_check_in", label: "Client misses a check-in", description: "When a client misses a scheduled check-in." },
  { key: "client_check_in_reminder", label: "Client check-in reminder", description: "A reminder before a client's check-in is due." },
  { key: "client_birthday", label: "Client's birthday", description: "On a client's birthday." },
  { key: "supplement_plan_updated", label: "Supplement plan updated", description: "When a client's supplement plan changes." },
];

export const TRIGGER_LABELS: Record<string, string> = Object.fromEntries(
  TRIGGER_CATALOG.map((t) => [t.key, t.label]),
);

/** Personalisation short-codes available in message templates. */
export const SHORTCODES = ["[FIRST_NAME]", "[LAST_NAME]"];

export interface MessageInput {
  id?: number;
  channel: Channel;
  subject: string | null;
  template: string;
  attachmentFilename: string | null;
  attachmentOriginal: string | null;
  delayValue: number;
  delayUnit: IntervalUnit;
}

export interface TriggerInput {
  key: string;
  enabled: boolean;
  externalEnabled: boolean;
  messages: MessageInput[];
}

export function blankMessage(): MessageInput {
  return {
    channel: "chat",
    subject: null,
    template: "",
    attachmentFilename: null,
    attachmentOriginal: null,
    delayValue: 0,
    delayUnit: "minutes",
  };
}

export const CHANNEL_LABEL: Record<Channel, string> = { email: "Email", push: "Push", chat: "Chat" };
