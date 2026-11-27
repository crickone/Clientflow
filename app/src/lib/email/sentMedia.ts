import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { emailMessages } from "@/lib/db/schema";
import type { MessageMedia } from "@/lib/inbox/mediaModel";

/**
 * Note the files a sent email carried on its inbox row (email_messages), so
 * the thread shows them. The row is keyed by the provider's message id: SMTP
 * and the Mailgun route write it while sending, Gmail when the inbox re-syncs
 * after the send. No row (Resend keeps none) or no files: nothing happens.
 * Never throws.
 */
export function setSentEmailMedia(providerMessageId: string, media: MessageMedia[]): void {
  if (!providerMessageId || media.length === 0) return;
  try {
    db.update(emailMessages)
      .set({ media: JSON.stringify(media) })
      .where(eq(emailMessages.gmailMessageId, providerMessageId))
      .run();
  } catch (err) {
    console.error("[email] could not note the sent files on the inbox row:", err);
  }
}
