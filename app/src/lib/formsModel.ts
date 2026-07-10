// Pure forms model — types, per-type metadata, field types, and the suggested
// question catalogs Kahunas pre-fills for each form type.

export type FormType = "initial" | "checkin" | "habits" | "contact" | "terms";

export type FieldType = "number" | "short" | "long" | "dropdown" | "photo" | "video" | "metric";

export const FIELD_TYPES: { key: FieldType; label: string }[] = [
  { key: "number", label: "Number" },
  { key: "short", label: "Short Answer" },
  { key: "long", label: "Long Answer" },
  { key: "dropdown", label: "Dropdown" },
  { key: "photo", label: "Upload Photo" },
  { key: "video", label: "Upload Video" },
];
export const FIELD_TYPE_LABEL: Record<string, string> = {
  ...Object.fromEntries(FIELD_TYPES.map((f) => [f.key, f.label])),
  metric: "Tracked metric",
};

export interface FormTypeMeta {
  key: FormType;
  label: string; // list page title, e.g. "Initial Questionnaire"
  addLabel: string; // "Add Initial Questionnaire"
  builderTitle: string; // "Add New Initial Questionnaire"
  navLabel: string;
  kind: "wizard" | "contact" | "terms";
  intro: string[];
  sections: { key: string; label: string }[];
}

export const FORM_TYPE_META: Record<FormType, FormTypeMeta> = {
  initial: {
    key: "initial",
    label: "Initial Questionnaire",
    addLabel: "Add Initial Questionnaire",
    builderTitle: "Add New Initial Questionnaire",
    navLabel: "Initial Questionnaire",
    kind: "wizard",
    intro: [
      "This is the form your clients will fill out when they first log in to their dashboard.",
      "We've pre-filled some essential fields to get you started — review, customize, and add anything extra.",
    ],
    sections: [{ key: "main", label: "Questions" }],
  },
  checkin: {
    key: "checkin",
    label: "Check-in Form",
    addLabel: "Add Check-in Form",
    builderTitle: "Add New Check in Form",
    navLabel: "Check In Form",
    kind: "wizard",
    intro: [
      "This is the form your clients will complete weekly during their check-ins.",
      "We've already included some essential fields to help you get started.",
    ],
    sections: [
      { key: "checkin", label: "Checkins Questions" },
      { key: "progress", label: "Progress Tracking Questions" },
    ],
  },
  habits: {
    key: "habits",
    label: "Daily Habits",
    addLabel: "Add Habit Form",
    builderTitle: "Add New Daily Habit Form",
    navLabel: "Daily Habits",
    kind: "wizard",
    intro: [
      "This is the form your clients will complete each day when they log in.",
      "We've pre-filled some essential fields — review and customize them to fit your coaching style.",
    ],
    sections: [
      { key: "habit", label: "Habit Tracking Questions" },
      { key: "progress", label: "Progress Tracking Questions" },
    ],
  },
  contact: {
    key: "contact",
    label: "Contact Forms",
    addLabel: "Add contact form",
    builderTitle: "Add New Contact Form",
    navLabel: "Contact Forms",
    kind: "contact",
    intro: ["A public lead-capture form. Share the link on your website or socials to collect enquiries."],
    sections: [{ key: "main", label: "Fields" }],
  },
  terms: {
    key: "terms",
    label: "Terms & Conditions",
    addLabel: "Add Terms",
    builderTitle: "Add New Terms & Conditions",
    navLabel: "Terms & Conditions",
    kind: "terms",
    intro: ["The terms your clients agree to when they join."],
    sections: [],
  },
};

export const FORM_TYPES = Object.keys(FORM_TYPE_META) as FormType[];

export interface QuestionInput {
  id?: number;
  section: string;
  label: string;
  fieldType: FieldType;
  options: string[];
  required: boolean;
  isMetric: boolean;
}

export interface FormInput {
  id?: number;
  type: FormType;
  title: string;
  isDefault: boolean;
  status: boolean;
  triggerStatus: boolean;
  content: string | null;
  questions: QuestionInput[];
}

interface Suggestion {
  section: string;
  label: string;
  fieldType: FieldType;
  isMetric?: boolean;
}

/** Progress-tracking metrics offered on Check-in + Daily Habit forms. */
const PROGRESS_METRICS = [
  "Weight",
  "Quality of sleep",
  "Stress",
  "HRV",
  "Fatigue",
  "Hunger",
  "Recovery",
  "Energy",
  "Digestion",
  "Steps",
  "Glucose level",
  "Waist",
  "Exercise Minutes",
  "Active & Resting Energy",
  "Stand Minutes",
  "Resting Heart Rate",
  "Walking/Running Distance",
  "Flights climbed",
  "Respiratory Rate",
  "Sleep time",
  "Walking Heart Rate Average",
  "VO2 max",
];
const progressSuggestions: Suggestion[] = PROGRESS_METRICS.map((label) => ({
  section: "progress",
  label,
  fieldType: "metric",
  isMetric: true,
}));

export const SUGGESTIONS: Record<FormType, Suggestion[]> = {
  initial: [
    { section: "main", label: "Weight", fieldType: "number" },
    { section: "main", label: "Waist", fieldType: "number" },
    { section: "main", label: "Height", fieldType: "number" },
    { section: "main", label: "Age", fieldType: "number" },
    { section: "main", label: "Detail your current diet", fieldType: "long" },
    { section: "main", label: "Allergies/dislikes", fieldType: "long" },
    { section: "main", label: "Supplements you take", fieldType: "long" },
    { section: "main", label: "No of years training", fieldType: "short" },
    { section: "main", label: "Current workouts", fieldType: "long" },
    { section: "main", label: "Goal physique", fieldType: "photo" },
    { section: "main", label: "Any medical issues", fieldType: "long" },
    { section: "main", label: "Anything else I should know", fieldType: "long" },
    { section: "main", label: "Current photos", fieldType: "photo" },
  ],
  checkin: [
    { section: "checkin", label: "Detail your diet from the last week", fieldType: "long" },
    { section: "checkin", label: "Did you stick to the diet?", fieldType: "dropdown" },
    { section: "checkin", label: "How do you feel/overall well being?", fieldType: "long" },
    { section: "checkin", label: "Current photos (front, back, side)", fieldType: "photo" },
    { section: "checkin", label: "Video Uploads", fieldType: "video" },
    { section: "checkin", label: "Anything else?", fieldType: "long" },
    ...progressSuggestions,
  ],
  habits: [
    { section: "habit", label: "Drink 2L water per day", fieldType: "short" },
    { section: "habit", label: "Walk 10,000 steps", fieldType: "short" },
    { section: "habit", label: "Meditate for 10 min", fieldType: "short" },
    { section: "habit", label: "Get 10 min of sunshine", fieldType: "short" },
    ...progressSuggestions,
  ],
  contact: [
    { section: "main", label: "Full name", fieldType: "short" },
    { section: "main", label: "Email", fieldType: "short" },
    { section: "main", label: "Phone", fieldType: "short" },
    { section: "main", label: "What are your goals?", fieldType: "long" },
  ],
  terms: [],
};

export function suggestionToQuestion(s: Suggestion): QuestionInput {
  return {
    section: s.section,
    label: s.label,
    fieldType: s.fieldType,
    options: s.fieldType === "dropdown" ? ["Yes", "No"] : [],
    required: false,
    isMetric: !!s.isMetric,
  };
}

export function blankQuestion(section = "main"): QuestionInput {
  return { section, label: "", fieldType: "short", options: [], required: false, isMetric: false };
}

export function blankForm(type: FormType): FormInput {
  return {
    type,
    title: "",
    isDefault: false,
    status: true,
    triggerStatus: false,
    content: null,
    questions: type === "terms" || type === "contact" ? [] : SUGGESTIONS[type].map(suggestionToQuestion),
  };
}
