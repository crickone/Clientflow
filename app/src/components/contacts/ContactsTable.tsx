"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowUpRight, EyeOff, RefreshCw, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { addContactAsLeadAction, hideWhatsAppContactAction, refreshWhatsAppContactsAction } from "@/app/contacts/actions";
import type { DirectoryTag, Person } from "@/lib/contacts/directoryModel";
import type { ContactsSyncState } from "@/lib/whatsapp/contactsSync";

const TAG_TONE: Record<DirectoryTag["kind"], "success" | "info" | "neutral" | "warning" | "green"> = {
  client: "success",
  lead: "info",
  not_lead: "neutral",
  mailing: "warning",
  whatsapp: "green",
};

const DAY = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
const when = (ms: number | null) => (ms ? DAY.format(new Date(ms)) : "No messages");

function openHref(p: Person): string | null {
  if (p.clientId) return `/clients/${p.clientId}`;
  if (p.leadId) return `/leads/${p.leadId}`;
  if (p.inboxLeadId) return `/communication?open=${encodeURIComponent(`conv:lead-${p.inboxLeadId}`)}`;
  return null;
}

/** What "Add as lead" adds: the Inbox conversation, else the WhatsApp contact, else the mailing-list entry. */
function addSource(p: Person): { kind: "inbox" | "whatsapp" | "mailing"; id: number } | null {
  if (p.category !== "not_lead") return null;
  if (p.inboxLeadId) return { kind: "inbox", id: p.inboxLeadId };
  if (p.whatsappId) return { kind: "whatsapp", id: p.whatsappId };
  if (p.mailingId) return { kind: "mailing", id: p.mailingId };
  return null;
}

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "#";
}

export function ContactsTable({ people, empty }: { people: Person[]; empty: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  if (people.length === 0) {
    return <EmptyState icon={<Users size={32} strokeWidth={1.4} />} title="No contacts" message={empty} />;
  }

  const addAsLead = (p: Person) => {
    const from = addSource(p);
    if (!from) return;
    setBusy(p.key);
    start(async () => {
      const r = await addContactAsLeadAction(from);
      setBusy(null);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${p.name} added to your pipeline as a lead.`);
      router.refresh();
    });
  };

  const hide = (p: Person) => {
    if (!p.whatsappId) return;
    setBusy(p.key);
    start(async () => {
      const r = await hideWhatsAppContactAction(p.whatsappId!);
      setBusy(null);
      if (!r.ok) {
        toast.error("This contact could not be hidden.");
        return;
      }
      toast.success(`${p.name} hidden from Contacts.`);
      router.refresh();
    });
  };

  return (
    <div className="ct-wrap">
      <div className="ct-table" role="table" aria-label="Contacts">
        <div className="ct-row ct-head" role="row">
          <span role="columnheader">Name</span>
          <span role="columnheader">Phone</span>
          <span role="columnheader">Email</span>
          <span role="columnheader">Last message</span>
          <span role="columnheader" className="ct-sr">Actions</span>
        </div>
        {people.map((p) => {
          const href = openHref(p);
          const add = addSource(p);
          const rowBusy = pending && busy === p.key;
          return (
            <div key={p.key} className="ct-row" role="row">
              <div className="ct-who" role="cell">
                <span className="ct-avatar" aria-hidden>{initials(p.name)}</span>
                <div className="ct-who-text">
                  {href ? (
                    <Link href={href} className="ct-name">{p.name}</Link>
                  ) : (
                    <span className="ct-name">{p.name}</span>
                  )}
                  <div className="ct-tags">
                    {p.tags.map((t) => (
                      <Badge key={t.kind} tone={TAG_TONE[t.kind]}>{t.label}</Badge>
                    ))}
                  </div>
                </div>
              </div>
              <span className="ct-cell ct-phone" role="cell" data-label="Phone">{p.phone ?? "No phone"}</span>
              <span className="ct-cell ct-email" role="cell" data-label="Email" title={p.email ?? undefined}>{p.email ?? "No email"}</span>
              <span className="ct-cell ct-when" role="cell" data-label="Last message">{when(p.lastAt)}</span>
              <div className="ct-acts" role="cell">
                {href && (
                  <Link href={href} className="ct-open">
                    Open <ArrowUpRight size={13} />
                  </Link>
                )}
                {add && (
                  <Button size="sm" variant="outline" onClick={() => addAsLead(p)} loading={rowBusy} disabled={pending && !rowBusy}>
                    <UserPlus size={13} /> Add as lead
                  </Button>
                )}
                {p.whatsappOnly && p.whatsappId && (
                  <Button size="sm" variant="ghost" onClick={() => hide(p)} disabled={pending} aria-label={`Hide ${p.name}`} title="Hide from Contacts">
                    <EyeOff size={14} />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The header's WhatsApp import: when it last worked, why it did not, and a button to run it now. */
export function RefreshWhatsApp({ connected, sync }: { connected: boolean; sync: ContactsSyncState }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!connected) {
    return (
      <Link href="/settings/integrations/whatsapp" className="ct-sync-note">
        Connect WhatsApp to bring in its contacts
      </Link>
    );
  }
  const status = sync.error
    ? `Last import failed: ${sync.error}`
    : sync.okAt
      ? `${(sync.count ?? 0).toLocaleString("en-IE")} from WhatsApp, updated ${DAY.format(new Date(sync.okAt))}`
      : "WhatsApp contacts are being brought in";
  const refresh = () =>
    start(async () => {
      const r = await refreshWhatsAppContactsAction();
      if (!r.ok) toast.error(r.error);
      else toast.success(`${r.count.toLocaleString("en-IE")} WhatsApp contacts up to date.`);
      router.refresh();
    });
  return (
    <div className="ct-sync">
      <span className="ct-sync-note" data-error={sync.error ? "" : undefined}>{status}</span>
      <Button size="sm" variant="outline" onClick={refresh} loading={pending}>
        <RefreshCw size={14} /> Refresh from WhatsApp
      </Button>
    </div>
  );
}
