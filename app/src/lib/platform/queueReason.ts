/** The reason shown under a failed-queue alert: the latest failure's error, tidied. */
export function queueReason(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}
