/**
 * The skills every tenant starts with.
 * ZERO RUNTIME IMPORTS — seeded by ./skills.ts, tested without a database.
 *
 * WRITTEN HERE, NOT IMPORTED. Shipping someone else's SKILL.md inside the
 * product is redistribution, and the good ones carry licences (MIT, Apache
 * 2.0) with attribution terms — worth honouring rather than quietly pasting.
 * Third-party skills belong in the Fetch box on the Skills page, which pulls
 * them from their own repository at the moment an operator chooses one.
 *
 * Every rule below was written the hard way: each is a thing a real generation
 * got wrong for a real client, in this app, and the wording is the wording
 * that fixed it. That is also why they are short. A skill nobody reads to the
 * end is a skill the model skims too.
 *
 * ALL "always". These are standing rules about how to write, and a style rule
 * the model has to decide is relevant before applying is no rule at all. The
 * onDemand mode is for reference material — design guidelines, a brand book —
 * that earns its tokens on some jobs and wastes them on the rest.
 */
import type { SkillLoadMode } from "./skills.parse";

export interface DefaultSkill {
  name: string;
  description: string;
  body: string;
  loadMode: SkillLoadMode;
}

export const DEFAULT_SKILLS: DefaultSkill[] = [
  {
    name: "Say the thing",
    description: "Cuts atmosphere-as-filler and keeps every sentence carrying something real",
    loadMode: "always",
    body: `Every sentence carries something the reader could act on, check, or picture exactly: what a thing is, how long it takes, what they do while it happens, who it suits, what to do next.

A sentence whose only content is atmosphere is filler. "The warmth builds slowly while the room stays quiet around you" tells a reader nothing they had not already assumed, and a post built of those says nothing while sounding like it said something.

This is NOT a ban on describing an experience, which is often the most useful thing you can write. It is the difference between concrete and vague:

- "You lie face-up, fully clothed, for twelve minutes" — the experience. Keep it.
- "You can read in there, or sleep" — the experience. Keep it.
- "A calm space where the day slows down" — mood. Cut it.

Mood is what copy reaches for when it has run out of facts. When you catch yourself writing one, either fetch a real detail from the business context or cut the sentence. Shorter and specific beats longer and vague.

Write in active voice. Make verbs do the work: "decided", not "made a decision"; "can", not "has the ability to".

Use the portability test. If a sentence could move unchanged to another business, another town, or another service, it is filler. Replace it with a fact, an example, a mechanism, or a consequence specific to this subject.`,
  },
  {
    name: "Teach something",
    description: "Every piece leaves the reader knowing something they did not know",
    loadMode: "always",
    body: `A reader who finishes must know something they did not know when they started: how a thing actually works, what makes two options different, why one suits a person and another does not.

Describing a room is not teaching. "You lie down, the door closes, sixty minutes, nothing to do but rest" tells a reader what an hour looks like and nothing about what the thing IS or does.

EXPLAIN THE MECHANISM. What physically happens is a fact, and it is the most useful thing you can put in front of someone. "Pressure rises and more oxygen dissolves into the blood plasma" is mechanism. "The vessels near the surface widen" is mechanism. "This will fix your fatigue" is a claim, and that you never write. Where the business context gives you the mechanism, use it. Where it does not, say plainly what the thing is rather than reaching for how it feels.

A COMPARISON OWES THE READER THE DIFFERENCE. If the piece asks "X or Y", the middle of it explains what actually separates them: the mechanism of each, what each is for, who picks which and why. "Which of these two moods would you prefer?" is not a comparison — it is a way of avoiding one. If you do not have the facts for a real difference, this is the wrong piece: write about one of them properly instead.`,
  },
  {
    name: "Never invent a fact",
    description: "Numbers, equipment and what a session is like all come from the business, or are left out",
    loadMode: "always",
    body: `Take prices, session lengths, opening times and every other number ONLY from this account's own service list and business context. If a number is not there, write the sentence without it. A plausible-looking price is worse than no price, because someone will arrive expecting it.

Do not contradict yourself. If a session is fifteen minutes on one slide it is fifteen minutes on the next. Check a number against the service list before you write it a second time.

THIS COVERS THE EQUIPMENT, not only the numbers. Do not describe what a machine looks like, whether it encloses someone, what a room feels like, what a client hears, or what they can do during a session, unless the business context says so. These are the easiest things to get wrong and the hardest for anyone to catch, because they read as harmless colour.

A real example: a post described an infrared BED as "open, no seal" purely to sharpen a contrast with a sealed chamber. Nothing in the brief said any such thing, and the bed is not open. Where you need a contrast and do not have the facts for one, build it from what you DO know, or write the line without it.

Never cite a study, a journal, an author, an institution or a year. Never invent a statistic or a percentage. "Experts agree", "studies show" and "widely regarded as" are the same offence with the source left blank — name it or cut the claim.

Never quote a testimonial you were not given. You may quote one that exists; you may not write one.`,
  },
  {
    name: "Clinic and wellness compliance",
    description: "Irish health-advertising guardrails: no cures, no conditions treated, mechanism is fine",
    loadMode: "always",
    body: `For a clinic, gym or wellness business, these are not style preferences.

NEVER say a service cures, treats, heals, fixes or resolves a condition. Do not promise a therapeutic outcome or a result.

NEVER name a medical condition as something this business treats. Services whose NAME contains a condition may be stated as service names only.

Keep outcome claims hedged: "supports", "many people find", "research suggests".

NONE OF THAT STOPS YOU EXPLAINING HOW SOMETHING WORKS. What the equipment does and what physically happens in the body is description, not a promise, and it is usually the most useful thing on the page. "Pressure rises and more oxygen dissolves into the plasma" is fine. "This will fix your fatigue" is not. Write the first kind freely; never the second.

No hype: "revolutionary", "miracle", "unlock", "game-changer", "detox your body".

Never promise money back, free trials, or a free session or treatment.

A post that breaks none of these and teaches nothing has still failed. These rules bound the writing; they are not the point of it.`,
  },
];
