import { eq, sql } from "drizzle-orm";

import { PageHeader } from "@/components/layout/PageHeader";
import { ScheduleBoard } from "@/components/marketing/ScheduleBoard";
import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { listCarousels } from "@/lib/image/carousels";
import { listScheduledEmailCampaigns } from "@/lib/marketing/schedule";
import { isMetaConnected } from "@/lib/social/publisher";
import { listScheduledPosts } from "@/lib/social/schedule";

export const dynamic = "force-dynamic";

/**
 * Everything booked for a time, in one place: scheduled social posts (and
 * whether posting is connected yet), scheduled email sends, and the size of
 * the nurture queue. Booking happens here for posts, on the campaign page
 * for emails, and through Adonis for both.
 */
export default async function SchedulePage() {
  await requireAdminPage();
  const tenantId = getCurrentMembership()!.tenant.id;

  const posts = listScheduledPosts({ includeDone: true })
    // Finished rows drop off after a while so the list stays about what is
    // coming; the last few posted/failed stay visible as a record.
    .filter((p, i, all) => p.status === "scheduled" || p.status === "posting" || i >= all.length - 10)
    .map((p) => ({
      id: p.id,
      designId: p.carouselSetId,
      designName: p.designName,
      channels: p.channels,
      scheduledFor: p.scheduledFor,
      status: p.status,
      note: p.error,
      slideCount: p.slideCount,
    }));

  const emails = listScheduledEmailCampaigns().map((c) => ({
    id: c.id,
    name: c.name,
    subject: c.subject,
    scheduledAt: c.scheduledAt,
  }));

  const designs = listCarousels()
    .filter((c) => c.generationStatus == null && c.slideCount > 0)
    .map((c) => ({ id: c.id, name: c.name }));

  const nurtureQueued =
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.automationQueue)
      .where(eq(schema.automationQueue.status, "queued"))
      .get()?.n ?? 0;

  return (
    <div className="app-page" style={{ maxWidth: 1000 }}>
      <PageHeader
        eyebrow="Marketing"
        title="Schedule"
        subtitle="Posts and email sends booked for a time. Adonis can book these for you from the chat."
      />
      <ScheduleBoard
        posts={posts}
        emails={emails}
        designs={designs}
        postingConnected={isMetaConnected(tenantId)}
        nurtureQueued={nurtureQueued}
      />
    </div>
  );
}
