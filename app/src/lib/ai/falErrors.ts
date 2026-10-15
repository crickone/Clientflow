/**
 * fal.ai (images and video) answers an empty account with 403 "User is
 * locked. Reason: TOP_UP" or an "Exhausted balance" message. Say what it
 * means and what to do, instead of the raw API text. Pure.
 */
export function falErrorMessage(kind: "Image" | "Video", status: number, body: string): string {
  if (/locked|top_?up|exhausted balance|insufficient (credit|balance)/i.test(body) || status === 402) {
    return `${kind} generation is paused: the fal.ai account that makes AI ${kind === "Image" ? "images" : "video"} is out of credit. Top it up at fal.ai/dashboard/billing and try again.`;
  }
  if (status === 401 || (status === 403 && /key|auth|credential/i.test(body))) {
    return `${kind} generation isn't connected: the fal.ai key was refused. Check FAL_KEY.`;
  }
  if (status === 429) return `${kind} generation is busy right now. Try again in a minute.`;
  return `${kind} API error ${status}: ${body.slice(0, 200)}`;
}
