import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { BlockManager } from "@/components/settings/BlockEditor";
import { db } from "@/lib/db";
import { blockOuts } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { requireAdminPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function BlocksPage() {
  await requireAdminPage();
  const items = db
    .select()
    .from(blockOuts)
    .orderBy(desc(blockOuts.createdAt))
    .all();
  return (
    <div className="app-page" style={{ maxWidth: 880 }}>
      <Link
        href="/settings"
        style={{
          color: "var(--text-tertiary)",
          fontSize: 13,
          marginBottom: 24,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <ArrowLeft size={14} /> Back to settings
      </Link>
      <PageHeader
        eyebrow="Settings"
        title="Block-out times"
        subtitle="Lunch breaks, holidays, equipment maintenance. The booking form refuses overlap; the calendar shows them shaded."
      />
      <BlockManager items={items} />
    </div>
  );
}
