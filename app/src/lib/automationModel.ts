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
export const SHORTCODES = ["[FIRST_NAME]", "[LAST_NAME]", "[BUSINESS_NAME]"];

/**
 * Replace short-codes with real values. Case-insensitive, so [first_name],
 * [FIRST_NAME] and [First_Name] all work. Unknown codes are left as-is.
 */
export function applyShortcodes(
  template: string,
  vars: { firstName?: string | null; lastName?: string | null; businessName?: string | null },
): string {
  const map: Record<string, string> = {
    first_name: (vars.firstName ?? "").trim(),
    last_name: (vars.lastName ?? "").trim(),
    business_name: (vars.businessName ?? "").trim(),
  };
  return template.replace(/\[([a-z_]+)\]/gi, (whole, key: string) => {
    const v = map[key.toLowerCase()];
    return v !== undefined ? v : whole;
  });
}

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

function msg(channel: Channel, subject: string | null, template: string): MessageInput {
  return { channel, subject, template, attachmentFilename: null, attachmentOriginal: null, delayValue: 0, delayUnit: "minutes" };
}

/** Ready-made starter message for each trigger (shown when none is configured). */
export const DEFAULT_MESSAGES: Record<string, MessageInput[]> = {
  new_client_created: [
    msg("email", "Welcome to [BUSINESS_NAME]!", "Hi [FIRST_NAME],\n\nWelcome to [BUSINESS_NAME] — we're delighted to have you on board! 🎉\n\nLog in to your app to see your plan, book classes and track your progress. If you have any questions at all, just reply to this message.\n\nLet's get started!"),
  ],
  client_check_in: [
    msg("chat", null, "Great work getting your check-in done, [FIRST_NAME]! 💪 I'll take a look and come back to you with any tweaks."),
  ],
  nutrition_plan_added: [
    msg("email", "Your new nutrition plan is ready, [FIRST_NAME]", "Hi [FIRST_NAME],\n\nYour new nutrition plan is live in your app. Have a read through and let me know if anything isn't clear. Consistency is everything — you've got this!"),
  ],
  initial_qa_form: [
    msg("chat", null, "Thanks for filling out your questionnaire, [FIRST_NAME]! This helps me tailor everything to you — your plan is on the way."),
  ],
  workout_plan_added: [
    msg("email", "Your new training plan, [FIRST_NAME] 🏋️", "Hi [FIRST_NAME],\n\nYour new workout program is ready in your app. Take a look and let's get after it. Message me if you have any questions about the exercises or the plan."),
  ],
  supplement_plan_added: [
    msg("chat", null, "Hi [FIRST_NAME], your supplement plan is ready in your app. Any questions, just ask!"),
  ],
  workout_plan_updated: [
    msg("chat", null, "Hi [FIRST_NAME], I've updated your workout program — the latest version is in your app. 💪"),
  ],
  nutrition_plan_updated: [
    msg("chat", null, "Hi [FIRST_NAME], I've tweaked your nutrition plan — the updated version is ready in your app."),
  ],
  client_missed_check_in: [
    msg("chat", null, "Hi [FIRST_NAME], I noticed your check-in didn't come through this week — everything okay? Drop me a message whenever you're ready."),
  ],
  client_check_in_reminder: [
    msg("push", null, "Hi [FIRST_NAME], your check-in is due soon — take 2 minutes to log how the week went. 📋"),
  ],
  client_birthday: [
    msg("email", "Happy birthday, [FIRST_NAME]! 🎉", "Happy birthday, [FIRST_NAME]! 🎉\n\nWishing you a brilliant day from all of us at [BUSINESS_NAME]. Enjoy every minute — you deserve it!"),
  ],
  supplement_plan_updated: [
    msg("chat", null, "Hi [FIRST_NAME], your supplement plan has been updated — check the app for the details."),
  ],
};
