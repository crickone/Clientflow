/**
 * How generated copy asks for the next step — one rule per FORMAT.
 *
 * Left to itself the model reaches for "register your interest" / "enquire
 * about the next intake": enquiry-desk phrasing no gym or clinic here actually
 * uses. The real next step is always signing up, but HOW you point at it
 * depends on where the copy lands:
 *
 *   - social — an Instagram/Facebook post can't carry a link, so the only
 *     honest instruction is the bio link.
 *   - ad      — the ad itself IS the link, so "click the link" is literal and
 *     "link in bio" would be wrong.
 *   - blog / email — the copy can carry a real URL, so it names one when the
 *     business has set its sign-up page.
 *
 * Zero imports, so this loads under the plain tsx test runner and is usable
 * both from the server-only prompt builders (via businessContext's
 * getSignoffRule, which supplies the sign-up URL from the Business Profile)
 * and from the pure campaign prompt module.
 */

export type CopyFormat = "social" | "ad" | "blog" | "email";

/** Phrasings that must never appear, whatever the format. */
const NEVER =
  'NEVER ask people to "register your interest", "express your interest", "enquire", or "get in touch about the next intake". Those are not phrases this business uses.';

/**
 * The sign-off instruction for one format.
 *
 * @param signupUrl the business's sign-up page. Only "blog" and "email" use it;
 *   when it's blank they still say "click the link to sign up" and the operator
 *   adds the link themselves.
 */
export function signoffRule(format: CopyFormat, signupUrl?: string): string {
  const url = (signupUrl ?? "").trim();

  switch (format) {
    case "social":
      return `Sign-off — how this post asks for the next step:
- The next step is ALWAYS the link in the bio. Close on it: "Click the link in bio to sign up." Small variations are fine as long as they still point at the link in bio and ask them to sign up.
- ${NEVER}`;

    case "ad":
      return `Sign-off — how this ad asks for the next step:
- The ad carries its own link, so ask for the click directly: "Click the link to sign up." Never say "link in bio" — that is for organic posts, not ads.
- ${NEVER}`;

    case "blog":
      return `Sign-off — how this post asks for the next step:
- Close by asking the reader to sign up: "Click the link to sign up."
${
  url
    ? `- Make it a real markdown link to the sign-up page: [click the link to sign up](${url}). Use that exact URL, and link it once only — in the closing paragraph.`
    : "- No sign-up URL has been set in Settings > Business, so write the line without a link and leave the operator to add one."
}
- ${NEVER}`;

    case "email":
      return `Sign-off — how this email asks for the next step:
- Close by asking the reader to sign up: "Click the link to sign up."
${
  url
    ? `- The body is plain text, so put the URL on its own line, bare: ${url}. Use that exact URL, once only.`
    : "- No sign-up URL has been set in Settings > Business, so write the line without a link and leave the operator to add one."
}
- ${NEVER}`;
  }
}
