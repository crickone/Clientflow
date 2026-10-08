/**
 * The brief behind an ad and the copy each version carries. Pure: shared by
 * the generator, the editor and the Ads manager hand-off, and tested.
 */
import { CTAS, type Cta, type Objective } from "./spec";

export const AD_GOALS = ["bookings", "leads", "messages", "website", "awareness"] as const;
export type AdGoal = (typeof AD_GOALS)[number];

export const AD_GOAL_LABEL: Record<AdGoal, string> = {
  bookings: "Get bookings",
  leads: "Collect leads (instant form)",
  messages: "Start conversations",
  website: "Send people to the website",
  awareness: "Get known locally",
};

/** The button words a goal's default call to action shows (client-safe). */
export const GOAL_BUTTON: Record<AdGoal, string> = {
  bookings: "Book now",
  leads: "Sign up",
  messages: "Send message",
  website: "Learn more",
  awareness: "Learn more",
};

/** The Meta campaign objective an ad's goal runs under in the Ads manager. */
export const GOAL_OBJECTIVE: Record<AdGoal, Objective> = {
  bookings: "traffic",
  leads: "leads",
  messages: "messages",
  website: "traffic",
  awareness: "awareness",
};

export interface AdBrief {
  /** What is being advertised: the service, offer or event. */
  offer: string;
  /** Who it is for, in the operator's words. Optional. */
  audience: string;
  goal: AdGoal;
  /** Where the button sends people, for website / bookings goals. */
  linkUrl: string;
}

export interface AdCopy {
  /** The idea this version tests, in a few words ("the time it takes"). */
  angle: string;
  /** The words ON the image: a short hook. */
  hook: string;
  /** Optional supporting line on the image. */
  support: string;
  /** Meta "primary text": above the image. */
  primaryText: string;
  /** Meta "headline": under the image, beside the button. */
  headline: string;
  /** Meta "description": the small line under the headline. */
  description: string;
  cta: Cta;
}

/** Meta's recommended lengths (longer text is cut off in the feed). */
export const LIMITS = { hook: 60, support: 110, primaryText: 300, headline: 40, description: 30 } as const;

export const DEFAULT_CTA: Record<AdGoal, Cta> = {
  bookings: "BOOK_NOW",
  leads: "SIGN_UP",
  messages: "MESSAGE_PAGE",
  website: "LEARN_MORE",
  awareness: "LEARN_MORE",
};

export function parseBrief(raw: unknown): AdBrief {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const goal = AD_GOALS.includes(o.goal as AdGoal) ? (o.goal as AdGoal) : "bookings";
  return {
    offer: String(o.offer ?? "").trim().slice(0, 600),
    audience: String(o.audience ?? "").trim().slice(0, 300),
    goal,
    linkUrl: String(o.linkUrl ?? "").trim().slice(0, 500),
  };
}

const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** One version's copy from the model (or a stored row), clipped and with a valid button. */
export function coerceCopy(raw: unknown, goal: AdGoal): AdCopy | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const hook = clip(o.hook, LIMITS.hook);
  const primaryText = String(o.primaryText ?? "").trim().slice(0, LIMITS.primaryText);
  const headline = clip(o.headline, LIMITS.headline);
  if (!hook || !primaryText || !headline) return null;
  return {
    angle: clip(o.angle, 60),
    hook,
    support: clip(o.support, LIMITS.support),
    primaryText,
    headline,
    description: clip(o.description, LIMITS.description),
    cta: (CTAS as readonly string[]).includes(String(o.cta)) ? (o.cta as Cta) : DEFAULT_CTA[goal],
  };
}

export function parseStoredCopy(json: string | null | undefined, goal: AdGoal = "bookings"): AdCopy | null {
  if (!json) return null;
  try {
    return coerceCopy(JSON.parse(json), goal);
  } catch {
    return null;
  }
}

/** The sizes every image ad is made in, in the order its slides are stored (feed first). */
export const AD_SIZES = ["4:5", "1:1", "9:16"] as const;
export type AdSize = (typeof AD_SIZES)[number];
export const AD_SIZE_LABEL: Record<AdSize, string> = {
  "4:5": "Feed (4:5)",
  "1:1": "Square (1:1)",
  "9:16": "Stories and Reels (9:16)",
};
