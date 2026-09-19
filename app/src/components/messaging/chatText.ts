/**
 * What the chat SHOWS, as opposed to what it sends.
 *
 * Two bits of plumbing were leaking into a conversation that is otherwise
 * written for a person, and both live here because they are pure string
 * work with nothing to do with React.
 */

/**
 * What a finished action should SAY.
 *
 * Every tool returns `{ text: JSON.stringify(...) }` by convention, and the
 * approved-write path used to append that string straight into the
 * conversation — so completing an image swap ended a friendly exchange with
 *
 *   {"result":"Replaced the image on / …","path":"/","siteId":1,"newSrc":"…"}
 *
 * The record is for the model; the sentence inside it is for the person. By
 * the same convention that blob always carries a `result` (or an `error`),
 * which is already written as a sentence, so this pulls that out and drops
 * the rest. Anything that is not JSON, or has neither key, is shown as it
 * came — better a raw line than a swallowed one.
 */
export function humanResult(text: string): string {
  try {
    const parsed = JSON.parse(text) as { result?: unknown; error?: unknown };
    if (typeof parsed?.result === "string" && parsed.result.trim()) return parsed.result.trim();
    if (typeof parsed?.error === "string" && parsed.error.trim()) return parsed.error.trim();
  } catch {
    // Not JSON — a tool that returns prose. Show it.
  }
  return text;
}

/**
 * The marker `send` adds so the model knows what was attached. It has to be
 * IN the message to reach the model, and out of the bubble so the operator
 * reads what they typed rather than our plumbing — MessageBubble strips it
 * and renders a chip instead.
 */
const ATTACHMENT_MARKER = /^\[Attached to the library: "(.+?)" — (\w+) #(\d+)\]$/gm;

export function splitAttachments(content: string): {
  body: string;
  attached: { name: string; kind: string; id: string }[];
} {
  const attached: { name: string; kind: string; id: string }[] = [];
  const body = content
    .replace(ATTACHMENT_MARKER, (_m, name: string, kind: string, id: string) => {
      attached.push({ name, kind, id });
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { body, attached };
}
