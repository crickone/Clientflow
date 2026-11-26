import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { ContactsTable, RefreshWhatsApp } from "@/components/contacts/ContactsTable";
import { loadDirectory } from "@/lib/contacts/directory";
import { DIRECTORY_FILTERS, filterDirectory, parseFilter } from "@/lib/contacts/directoryModel";
import { isWhatsAppConfigured } from "@/lib/whatsapp";
import { contactsSyncState, syncWhatsAppContactsIfNever } from "@/lib/whatsapp/contactsSync";

export const dynamic = "force-dynamic";

const PER_PAGE = 100;

interface Props {
  searchParams: Promise<{ q?: string; f?: string; p?: string }>;
}

export default async function ContactsPage(props: Props) {
  const sp = await props.searchParams;
  const q = (sp.q ?? "").slice(0, 100);
  const filter = parseFilter(sp.f);
  const page = Math.max(1, Math.floor(Number(sp.p) || 1));

  const whatsapp = isWhatsAppConfigured();
  if (whatsapp) syncWhatsAppContactsIfNever();
  const sync = contactsSyncState();

  const everyone = loadDirectory();
  const counts = new Map(DIRECTORY_FILTERS.map((f) => [f.key, filterDirectory(everyone, { filter: f.key }).length]));
  const matches = filterDirectory(everyone, { filter, q });
  const pages = Math.max(1, Math.ceil(matches.length / PER_PAGE));
  const current = Math.min(page, pages);
  const rows = matches.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  const href = (over: { f?: string; p?: number }) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    const f = over.f ?? filter;
    if (f !== "all") next.set("f", f);
    if (over.p && over.p > 1) next.set("p", String(over.p));
    return `/contacts${next.size ? `?${next}` : ""}`;
  };

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="People"
        title="Contacts"
        subtitle="Everyone in the system in one list: clients, leads, Inbox conversations, your mailing list and your WhatsApp contacts."
        actions={<RefreshWhatsApp connected={whatsapp} sync={sync} />}
      />

      <div className="ct-tools">
        <form action="/contacts" className="ct-search" role="search">
          <Search size={15} aria-hidden />
          <input name="q" defaultValue={q} placeholder="Search by name, phone or email" aria-label="Search contacts" />
          {filter !== "all" && <input type="hidden" name="f" value={filter} />}
        </form>
        <nav className="ct-filters" aria-label="Show">
          {DIRECTORY_FILTERS.map((f) => (
            <Link key={f.key} href={href({ f: f.key })} className="ct-filter" aria-current={f.key === filter ? "page" : undefined}>
              {f.label} <span>{(counts.get(f.key) ?? 0).toLocaleString("en-IE")}</span>
            </Link>
          ))}
        </nav>
      </div>

      <ContactsTable
        people={rows}
        empty={q ? "No one matches that search." : filter === "whatsapp" && !whatsapp ? "Connect WhatsApp in Settings to bring in its contacts." : "No one here yet."}
      />

      {pages > 1 && (
        <nav className="ct-pages" aria-label="Pages">
          <span>
            {((current - 1) * PER_PAGE + 1).toLocaleString("en-IE")}-{Math.min(current * PER_PAGE, matches.length).toLocaleString("en-IE")} of {matches.length.toLocaleString("en-IE")}
          </span>
          {current > 1 ? (
            <Link href={href({ p: current - 1 })} className="ct-page-btn"><ChevronLeft size={15} /> Previous</Link>
          ) : null}
          {current < pages ? (
            <Link href={href({ p: current + 1 })} className="ct-page-btn">Next <ChevronRight size={15} /></Link>
          ) : null}
        </nav>
      )}
    </div>
  );
}
