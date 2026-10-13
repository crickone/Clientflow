// Pure: pull a "Subject: ..." first line off a drafted email.

const LEADING_QUOTES = /^["'“‘]+/;
const TRAILING_QUOTES = /["'”’]+$/;

/**
 * The model is asked to start with "Subject: <line>", a blank line, then the
 * body. Returns the subject (markdown stars and wrapping quotes removed,
 * capped at 120 chars) and the body without that line, or subject null when
 * the reply doesn't start that way (the body is then returned untouched).
 */
export function splitSubjectLine(text: string): { subject: string | null; body: string } {
  const m = text.match(/^\s*\**subject\**[ \t]*:[ \t]*([^\r\n]*?)[ \t]*(?:\r?\n|$)/i);
  if (!m) return { subject: null, body: text };
  const subject = m[1].replace(/\*+/g, "").trim().replace(LEADING_QUOTES, "").replace(TRAILING_QUOTES, "").trim().slice(0, 120);
  if (!subject) return { subject: null, body: text };
  return { subject, body: text.slice(m[0].length).replace(/^\s*\n/, "").trimStart() };
}
