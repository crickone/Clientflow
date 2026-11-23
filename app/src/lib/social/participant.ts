/**
 * The sender's name from the Page's Messenger conversation list. The direct
 * profile lookup needs Meta's "Business Asset User Profile Access" approval
 * and fails without it (code 100/33); the conversation's participants carry
 * the name with the Page's ordinary messaging access. Pure.
 */
export function participantName(body: unknown, customerId: string): string | null {
  const convs = (body as { data?: { participants?: { data?: { id?: string; name?: string }[] } }[] } | null)?.data ?? [];
  for (const c of convs) {
    for (const p of c.participants?.data ?? []) {
      if (p.id === customerId && typeof p.name === "string" && p.name.trim()) return p.name.trim();
    }
  }
  return null;
}
