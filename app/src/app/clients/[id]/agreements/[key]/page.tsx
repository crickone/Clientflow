import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireUserPage } from "@/lib/auth";
import { agreedCopy } from "@/lib/agreements";
import { getClient } from "@/lib/queries";
import { Card } from "@/components/ui/Card";
import { DocText } from "@/components/agreements/DocText";

export const dynamic = "force-dynamic";

/** The exact text a member agreed to in the app, with when and from where: the record if it's ever questioned. */
export default async function AgreedCopyPage(props: { params: Promise<{ id: string; key: string }> }) {
  const params = await props.params;
  await requireUserPage();
  const id = Number(params.id);
  const client = await getClient(id);
  if (!client) notFound();
  const row = agreedCopy(id, decodeURIComponent(params.key));
  if (!row) notFound();
  const when = new Date(row.acceptedAt).toLocaleString("en-IE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Dublin" });

  return (
    <div className="app-page" style={{ maxWidth: 760 }}>
      <Link href={`/clients/${id}`} className="cp-back">
        <ArrowLeft size={14} /> {client.firstName} {client.lastName}
      </Link>
      <h1 className="cp-name" style={{ marginBottom: 6 }}>
        {row.title}
      </h1>
      <p className="cp-origin" style={{ marginBottom: 18 }}>
        {client.firstName} {client.lastName} agreed to {/^[0-9a-f]{8}$/.test(row.version) ? "this" : `version ${row.version}`} on {when}
        {row.ip ? ` from ${row.ip}` : ""}. This is the text they saw.
      </p>
      <Card className="cp-card">
        <DocText body={row.body} />
      </Card>
      {row.userAgent && (
        <p className="cp-origin" style={{ marginTop: 12, fontSize: 12 }}>
          Device: {row.userAgent}
        </p>
      )}
    </div>
  );
}
