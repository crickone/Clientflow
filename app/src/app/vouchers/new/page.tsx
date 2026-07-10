import { PageHeader } from "@/components/layout/PageHeader";
import { db } from "@/lib/db";
import { clients, therapies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NewVoucherForm } from "@/components/vouchers/NewVoucherForm";

export const dynamic = "force-dynamic";

export default function NewVoucherPage() {
  const therapyList = db
    .select()
    .from(therapies)
    .where(eq(therapies.isActive, true))
    .all();
  const clientList = db.select().from(clients).all();

  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader eyebrow="Vouchers" title="New gift voucher" />
      <NewVoucherForm clients={clientList} therapies={therapyList} />
    </div>
  );
}
