import "server-only";

import fs from "node:fs";

import { getCurrentTenant } from "@/lib/db/tenant";
import { inboxMediaPath } from "@/lib/inbox/media";
import { OUTGOING_LIMITS, OUTGOING_TOO_MANY_ERROR, type OutgoingFile } from "./outgoingModel";
import { verifyAttachment } from "./token";

export type { OutgoingFile } from "./outgoingModel";

export const ATTACHMENT_EXPIRED_ERROR = "That attachment has expired. Attach it again.";

/**
 * Turn the tickets a composer sent with its message into the files to send.
 * Every ticket must be this business's and unexpired, and its file must still
 * be in the business's inbox-media folder; one bad ticket refuses the whole
 * send (better than a message going out without the file the staff member
 * attached). Repeated tickets for the same file are sent once.
 * Empty or missing -> [].
 */
export function loadAttachments(tokens: string[] | undefined): OutgoingFile[] {
  if (!tokens || !Array.isArray(tokens) || tokens.length === 0) return [];
  if (tokens.length > OUTGOING_LIMITS.maxFiles) throw new Error(OUTGOING_TOO_MANY_ERROR);
  const tenant = getCurrentTenant();
  const out: OutgoingFile[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const media = typeof token === "string" ? verifyAttachment(token, tenant.id) : null;
    if (!media) throw new Error(ATTACHMENT_EXPIRED_ERROR);
    if (seen.has(media.file)) continue;
    const full = inboxMediaPath(tenant.slug, media.file);
    if (!full) throw new Error(ATTACHMENT_EXPIRED_ERROR);
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(full);
    } catch {
      throw new Error(ATTACHMENT_EXPIRED_ERROR);
    }
    seen.add(media.file);
    out.push({ media: { ...media, size: bytes.length }, bytes });
  }
  return out;
}
