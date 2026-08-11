import Link from "next/link";
import { count, desc } from "drizzle-orm";
import { Mail, Upload } from "lucide-react";

import { requireAdminPage } from "@/lib/auth";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

// Contacts imports can run up to 20,000 rows (see the import action's
// MAX_ROWS) — cap the rendered table so one huge tenant can't ship an
// unbounded server-rendered HTML table. Real search/pagination is a later
// task; this is just a safety valve, same idiom as the import preview's
// "showing the first N of total".
const LIST_LIMIT = 500;

const STATUS_TONE: Record<string, "neutral" | "amber" | "green" | "red"> = {
  subscribed: "green",
  unsubscribed: "neutral",
  bounced: "red",
  complained: "red",
  cleaned: "amber",
};

export default async function ContactsPage() {
  await requireAdminPage();

  const totalRow = db.select({ n: count() }).from(contacts).get();
  const total = totalRow?.n ?? 0;
  const rows = db
    .select()
    .from(contacts)
    .orderBy(desc(contacts.createdAt))
    .limit(LIST_LIMIT)
    .all();

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Email marketing"
        title="Contacts"
        subtitle="Your mailing list — import leads and customers, then build campaigns to reach them."
        actions={
          <Link href="/campaigns/contacts/import">
            <Button size="sm">
              <Upload size={14} /> Import contacts
            </Button>
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Mail size={32} strokeWidth={1.4} />}
          title="No contacts yet"
          message="Import a CSV of leads or customers to start building your mailing list."
          action={
            <Link href="/campaigns/contacts/import">
              <Button>
                <Upload size={15} /> Import contacts
              </Button>
            </Link>
          }
        />
      ) : (
        <>
          <div style={{ color: "var(--text-tertiary)", fontSize: 13, marginBottom: 12 }}>
            {total.toLocaleString()} contact{total === 1 ? "" : "s"}
            {total > rows.length ? ` · showing the most recent ${rows.length.toLocaleString()}` : ""}
          </div>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Email</th>
                  <th style={th}>Name</th>
                  <th style={th}>Phone</th>
                  <th style={th}>Status</th>
                  <th style={th}>Tags</th>
                  <th style={th}>Added</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const tags = safeParseTags(c.tags);
                  return (
                    <tr key={c.id}>
                      <td style={{ ...td, color: "var(--text-primary)" }}>{c.email}</td>
                      <td style={td}>{c.name || <Dim>—</Dim>}</td>
                      <td style={td}>{c.phone || <Dim>—</Dim>}</td>
                      <td style={td}>
                        <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status}</Badge>
                      </td>
                      <td style={td}>
                        {tags.length === 0 ? (
                          <Dim>—</Dim>
                        ) : (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {tags.map((t) => (
                              <Badge key={t}>{t}</Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={td}>{formatDate(c.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

function Dim({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--text-tertiary)" }}>{children}</span>;
}

function safeParseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "14px 16px",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--text-tertiary)",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  borderBottom: "1px solid var(--hairline)",
};
const td: React.CSSProperties = {
  padding: "14px 16px",
  borderBottom: "1px solid var(--hairline)",
  fontSize: 14,
  color: "var(--text-secondary)",
};
