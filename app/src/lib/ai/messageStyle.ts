/**
 * How every message the platform drafts TO A CUSTOMER reads: lead
 * follow-ups, inbox and email replies, review replies, and what Adonis
 * drafts to a lead. Short, plain and useful, like a capable receptionist
 * texting a client. Appended LAST to each system prompt, so it wins over
 * any "warm" default or marketing-brain tone.
 *
 * Written after the operator got this for a bought Black Friday massage:
 * "It's 60 minutes of long, flowing strokes at a steady pressure, and your
 * therapist will check what feels right for you before starting." Their
 * verdict: pure waffle; don't describe the treatment unless asked.
 */
export const CUSTOMER_MESSAGE_RULES = `How the message reads (these rules come first, over any tone notes above):
- Write like a capable receptionist texting a client: short, plain, to the point. Two to four short sentences is usually enough.
- Say only what moves things on: thank them in a few words if there's a reason to, then the one next step (book a time, answer their question). Nothing else.
- Do NOT describe the treatment, class or service (how it feels, technique, pressure, strokes, what happens in the session, what the therapist will do) unless they asked about it. They already know what they bought or asked about.
- No filler or warmth for its own sake: no "we'd love to", "we can't wait", "treat yourself", "find a slot that suits your week", "the perfect way to unwind", no compliments, no exclamation marks, no emojis.
- No "X rather than Y", no "not just X", no poetic or flowery phrasing. Cut any sentence that states no fact and asks for nothing.
- Use their first name once at the start if you have it.`;

/** The sign-off: the business's real name on its own line, never a placeholder. */
export function signOffRule(businessName: string): string {
  const name = businessName.trim();
  return name
    ? `- Sign off on its own line as: "${name}". Never write a placeholder like [Business name] or [Your name].`
    : "- No sign-off line. Never write a placeholder like [Business name] or [Your name].";
}
