/**
 * Turn a post idea into the topic the generator actually works from.
 *
 * The ideas generator returns real substance — what the post teaches, and the
 * established principle it rests on — and the picker used to hand the
 * generator the HOOK alone. That threw away the whole reason an idea was worth
 * choosing: the headline says what the post is called, `teaches` says what is
 * in it, and without the second one the generator re-derives the content from
 * a title and lands somewhere shallower than the idea it came from.
 *
 * The composed topic goes into the visible topic box rather than being carried
 * invisibly alongside it. An operator has to be able to see and edit what the
 * AI is working from — hidden context that silently steers the output is the
 * thing that makes these tools feel arbitrary.
 *
 * `needsSource` is deliberately LEFT OUT. It is a note to the operator ("find
 * a real citation before publishing"), and putting it in the prompt would
 * invite the model to reach for the number it is explicitly forbidden to
 * invent. It stays on the card, where a person reads it.
 *
 * Pure and dependency-free: it runs in the browser, where the picker lives.
 */

export interface TopicIdea {
  hook: string;
  teaches?: string;
  basis?: string;
}

export function ideaToTopic(idea: TopicIdea): string {
  const lines = [idea.hook.trim()];
  const teaches = idea.teaches?.trim();
  const basis = idea.basis?.trim();
  if (teaches) lines.push(`What it should teach: ${teaches}`);
  if (basis) lines.push(`It rests on: ${basis}`);
  return lines.join("\n\n");
}
