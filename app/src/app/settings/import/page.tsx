import Link from "next/link";
import { ChevronRight, FileSpreadsheet, Workflow } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { requireAdminPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ITEMS = [
  { href: "/settings/import/gohighlevel", icon: Workflow, title: "GoHighLevel", desc: "Your leads, clients and contacts, into the right columns and follow-ups." },
  { href: "/clients/import", icon: FileSpreadsheet, title: "Members from a spreadsheet", desc: "A CSV of members from another system." },
];

export default async function ImportIndexPage() {
  await requireAdminPage();
  return (
    <div className="app-page" style={{ maxWidth: 860 }}>
      <PageHeader eyebrow="Settings" title="Import" subtitle="Bring people in from the system you used before." />
      <ul className="set-list">
        {ITEMS.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="set-row">
              <span className="set-icon" aria-hidden>
                <s.icon size={17} strokeWidth={1.7} />
              </span>
              <span className="set-text">
                <span className="set-title">{s.title}</span>
                <span className="set-desc">{s.desc}</span>
              </span>
              <span className="set-status-none" />
              <ChevronRight size={16} className="set-chev" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
