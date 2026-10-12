/**
 * The brand interview: the questions Adonis asks a business owner so it can
 * write their brief, tone notes, marketing brain and AI image style. Pure
 * data, venue-aware (a gym and a clinic are asked about members vs clients,
 * training vs treatments), so the UI and the writer both read one list.
 *
 * Every question can be skipped. Chips are suggestions, never the only
 * answers: each chip question also takes typed "anything else".
 */

export type Venue = "gym" | "clinic";

export type QuestionKind = "text" | "long" | "chips" | "single";

export interface Question {
  id: string;
  /** The section it belongs to, shown above the question. */
  section: string;
  title: string;
  help?: string;
  kind: QuestionKind;
  placeholder?: string;
  options?: string[];
  /** Chips: how many may be picked (default unlimited). */
  max?: number;
}

export type Answers = Record<string, { text?: string; picks?: string[] }>;

export function interviewQuestions(venue: Venue, ctx: { name: string; town: string; services: string[] }): Question[] {
  const gym = venue === "gym";
  const people = gym ? "members" : "clients";
  const place = ctx.town ? ` in ${ctx.town}` : "";
  const name = ctx.name || "your business";
  const offerChips = ctx.services.length
    ? ctx.services.slice(0, 12)
    : gym
      ? ["Group classes", "Small group training", "Personal training", "Strength and conditioning", "Open gym", "Nutrition coaching", "Online coaching", "Over-50s", "Teens", "Mobility and recovery"]
      : ["Hyperbaric oxygen", "Infrared", "Massage", "Physiotherapy", "Sports massage", "Reflexology", "Skin treatments", "Nutrition advice", "Recovery packages"];

  return [
    {
      id: "oneLiner",
      section: "The basics",
      title: `In one sentence, what is ${name}?`,
      help: "The way you'd describe it to someone at a party.",
      kind: "text",
      placeholder: gym ? "A coach-led strength gym for adults who want to get fit and stay fit" : "A recovery clinic for people who train hard and people who need to switch off",
    },
    {
      id: "offer",
      section: "The basics",
      title: "What do you offer?",
      help: "Pick everything that applies, and add anything missing.",
      kind: "chips",
      options: offerChips,
    },
    {
      id: "story",
      section: "The basics",
      title: `How did ${name} start, and what do you care about most?`,
      help: "A few lines is plenty. This is where the real voice comes from.",
      kind: "long",
      placeholder: gym ? "Started in 2016 in a garage with eight members. We care about people sticking with it, not quick fixes." : "We opened after seeing how hard it was to find proper recovery care locally.",
    },
    {
      id: "who",
      section: `Your ${people}`,
      title: `Who is your ideal ${gym ? "member" : "client"}?`,
      help: "Pick the groups you most want more of.",
      kind: "chips",
      options: gym
        ? ["Complete beginners", "Busy parents", "Women 35 to 55", "Men 35 to 55", "Over-60s", "Young professionals", "Athletes and sports teams", "People coming back after a break"]
        : ["People who train hard", "Desk workers with stiffness", "Over-50s", "Busy parents", "Athletes and teams", "People recovering from injury", "Anyone who needs to switch off"],
    },
    {
      id: "whoDetail",
      section: `Your ${people}`,
      title: `Describe them in your own words.`,
      help: "Age, job, week, what their life looks like when they first walk in.",
      kind: "long",
      placeholder: gym ? "Mostly 35 to 55, busy jobs and kids, haven't trained properly in years and a bit nervous about it." : "Mostly 30 to 60. Some train, most just feel run down and want an hour that's theirs.",
    },
    {
      id: "goals",
      section: `Your ${people}`,
      title: "What do they want when they come to you?",
      kind: "chips",
      options: gym
        ? ["Get stronger", "Lose weight", "More energy", "Feel confident", "Move without pain", "Train for a sport", "Stay healthy as they age", "Be part of a community", "Build a routine"]
        : ["Recover faster", "Sleep better", "Less stiffness", "More energy", "Switch off", "Look after their skin", "Stay active as they age", "Get back to sport"],
    },
    {
      id: "fears",
      section: `Your ${people}`,
      title: "What stops people from signing up?",
      help: "The worries you hear before someone commits. Content that answers these sells.",
      kind: "chips",
      options: gym
        ? ["Too unfit to start", "Intimidated by gyms", "No time", "Cost", "An old injury", "Tried before and quit", "Don't know what to do", "Worried about being judged"]
        : ["Not sure it works", "Cost", "No time", "Claustrophobia", "Don't know which treatment", "Think it's only for athletes", "Never tried anything like it"],
    },
    {
      id: "different",
      section: "What makes you different",
      title: `Why would someone choose you over other ${gym ? "gyms" : "clinics"}${place}?`,
      help: "Be specific. 'Friendly staff' is what everyone says.",
      kind: "long",
      placeholder: gym ? "Every session is coached, classes are capped at 10, and we program for people over 40." : "We're the only place in town with a hyperbaric chamber, and every session is guided.",
    },
    {
      id: "team",
      section: "What makes you different",
      title: "Who's on the team?",
      help: "Names, roles and qualifications. Only what's true: Adonis never invents credentials.",
      kind: "long",
      placeholder: "DJ, owner and head coach, 15 years coaching, strength and conditioning qualified.",
    },
    {
      id: "proof",
      section: "What makes you different",
      title: "What results or stories are you proud of?",
      help: `Real ${people}, real changes. Adonis uses these as examples and never makes any up.`,
      kind: "long",
      placeholder: gym ? "A 62-year-old member deadlifted her bodyweight after a year. Lots of members have been with us 5+ years." : "A local hurler used the chamber through rehab and is back playing.",
    },
    {
      id: "start",
      section: "How people start",
      title: "How does someone get started with you?",
      help: "Your usual first step: a trial, an intro session, a consultation, a first block.",
      kind: "long",
      placeholder: gym ? "Book a free chat, then a 4-week starter block, then a membership." : "Book a single session, then most people buy a block of five.",
    },
    {
      id: "position",
      section: "How people start",
      title: "Where do you sit on price?",
      help: "Used for tone only. Prices are never written into content.",
      kind: "single",
      options: ["Affordable", "Mid-range", "Premium"],
    },
    {
      id: "tone",
      section: "How you sound",
      title: "Pick up to three words for how you want to sound.",
      kind: "chips",
      max: 3,
      options: ["Friendly", "Motivating", "No-nonsense", "Expert", "Warm", "Calm", "Fun", "Premium", "Down to earth", "Encouraging", "Straight-talking"],
    },
    {
      id: "pillars",
      section: "How you sound",
      title: "What should your posts teach people about?",
      help: "These become your content pillars.",
      kind: "chips",
      options: gym
        ? ["Training technique", "Programming and progress", "Nutrition", "Fat loss without fads", "Mobility and injury prevention", "Mindset and habits", "Training over 40", "Member stories", "Behind the scenes", "Myths and mistakes"]
        : ["How each therapy works", "Recovery for sport", "Sleep and stress", "Ageing well", "Skin health", "Client stories", "What a first visit is like", "Myths and mistakes", "Combining treatments"],
    },
    {
      id: "never",
      section: "How you sound",
      title: "Anything Adonis should never say or do?",
      kind: "chips",
      options: ["No prices in posts", "No before-and-after photos", "No body shaming", "No medical claims", "No slang", "No emojis", "No 'quick fix' promises", "Don't mention competitors"],
    },
    {
      id: "words",
      section: "How you sound",
      title: "Any words or phrases you love, or hate?",
      help: "Phrases you always use, words that make you cringe, how you spell things.",
      kind: "long",
      placeholder: gym ? "We say 'members', never 'clients'. Hate 'beast mode' and 'no pain no gain'." : "We say 'sessions', not 'treatments'. Hate 'detox'.",
    },
    {
      id: "look",
      section: "Your look",
      title: "What should your photos feel like?",
      help: "This becomes the style for every AI-made image.",
      kind: "chips",
      max: 3,
      options: gym
        ? ["Dark and moody", "Bright and energetic", "Gritty and real", "Clean and modern", "Warm and welcoming", "Black and gold", "Outdoors and natural light"]
        : ["Calm and bright", "Clean and clinical", "Warm and natural", "Spa-like", "Modern and premium", "Soft daylight", "Earthy tones"],
    },
  ];
}

/** Has the owner said anything at all? (Nothing to write from otherwise.) */
export function answeredCount(answers: Answers): number {
  return Object.values(answers).filter((a) => (a.text ?? "").trim() || (a.picks ?? []).length > 0).length;
}

/** The answers as plain lines for the writer, question by question, skipped ones left out. */
export function answersAsText(questions: Question[], answers: Answers): string {
  const lines: string[] = [];
  for (const q of questions) {
    const a = answers[q.id];
    if (!a) continue;
    const picks = (a.picks ?? []).filter(Boolean);
    const text = (a.text ?? "").trim();
    if (!picks.length && !text) continue;
    lines.push(`${q.title}\n${[picks.length ? picks.join(", ") : "", text].filter(Boolean).join(". ")}`);
  }
  return lines.join("\n\n");
}
