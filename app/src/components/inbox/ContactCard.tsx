"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowUpRight, Mail, Phone, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { addSenderAsLeadAction, type ContactContext } from "@/app/communication/actions";
import { hueOf, initials } from "./format";

/**
 * Who the person in the open conversation is: a member (and their
 * membership), a lead (and their pipeline stage), or someone not on file, with
 * one action. Two layouts from the same data: a side panel when the reading
 * pane is wide, a single strip above the thread when it is not (CSS container
 * query decides which shows).
 */

export function InboxAvatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span
      className="inbox-avatar"
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), ["--h" as string]: hueOf(name) }}
    >
      {initials(name)}
    </span>
  );
}

function typeLabel(ctx: ContactContext, memberLabel: string) {
  return ctx.type === "client" ? memberLabel : ctx.type === "lead" ? "Lead" : "Not on file";
}

const SOURCE_NAME: Record<string, string> = {
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  instagram: "Instagram",
  facebook: "Facebook",
  email: "Email",
  manual: "Added by hand",
  website: "Website",
};

const since = (ms: number) => new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });

function useAddLead(ctx: ContactContext | null, onAdded: (leadId: number) => void) {
  const [pending, start] = useTransition();
  const add = () => {
    if (!ctx || ctx.type !== "unknown" || !ctx.email) return;
    const { name, email } = ctx;
    start(async () => {
      const res = await addSenderAsLeadAction({ name, email });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Added to your pipeline as a lead.");
      onAdded(res.leadId);
    });
  };
  return { pending, add };
}

export function ContactPanel({
  ctx,
  memberLabel,
  canAddLead,
  onAdded,
}: {
  ctx: ContactContext | null;
  memberLabel: string;
  canAddLead: boolean;
  onAdded: (leadId: number) => void;
}) {
  const { pending, add } = useAddLead(ctx, onAdded);
  if (!ctx) {
    return (
      <aside className="inbox-context">
        <div className="skeleton" style={{ width: 52, height: 52, borderRadius: "50%" }} />
        <div className="skeleton" style={{ width: "70%", height: 14, borderRadius: 6, marginTop: 14 }} />
        <div className="skeleton" style={{ width: "45%", height: 11, borderRadius: 6, marginTop: 8 }} />
      </aside>
    );
  }
  const email = ctx.email;
  const phone = ctx.type === "unknown" ? null : ctx.phone;
  return (
    <aside className="inbox-context">
      <InboxAvatar name={ctx.name} size={52} />
      <div className="inbox-context-name">{ctx.name}</div>
      <span className={`inbox-pill inbox-pill--${ctx.type}`}>{typeLabel(ctx, memberLabel)}</span>

      <dl className="inbox-context-facts">
        {email && (
          <div>
            <dt><Mail size={13} /></dt>
            <dd title={email}>{email}</dd>
          </div>
        )}
        {phone && (
          <div>
            <dt><Phone size={13} /></dt>
            <dd>{phone}</dd>
          </div>
        )}
      </dl>

      {ctx.type === "client" && (
        <dl className="inbox-context-rows">
          <div><dt>Membership</dt><dd>{ctx.membership ? `${ctx.membership.name}${ctx.membership.status === "active" ? "" : ` (${ctx.membership.status})`}` : "None"}</dd></div>
          <div><dt>{memberLabel} since</dt><dd>{since(ctx.since)}</dd></div>
        </dl>
      )}
      {ctx.type === "lead" && (
        <dl className="inbox-context-rows">
          <div><dt>Stage</dt><dd>{ctx.stage ?? "Not set"}</dd></div>
          <div><dt>Source</dt><dd>{SOURCE_NAME[ctx.source.toLowerCase()] ?? ctx.source.charAt(0).toUpperCase() + ctx.source.slice(1)}</dd></div>
          <div><dt>Added</dt><dd>{since(ctx.since)}</dd></div>
        </dl>
      )}
      {ctx.type === "unknown" && (
        <p className="inbox-context-note">Not a {memberLabel.toLowerCase()} or lead yet.</p>
      )}

      <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
        {ctx.type !== "unknown" ? (
          <Link href={ctx.href}>
            <Button variant="outline" size="sm" style={{ width: "100%" }}>
              Open profile <ArrowUpRight size={14} />
            </Button>
          </Link>
        ) : canAddLead && email ? (
          <Button size="sm" onClick={add} loading={pending} style={{ width: "100%" }}>
            <UserPlus size={14} /> Add as lead
          </Button>
        ) : null}
      </div>
    </aside>
  );
}

export function ContactStrip({
  ctx,
  memberLabel,
  canAddLead,
  onAdded,
}: {
  ctx: ContactContext | null;
  memberLabel: string;
  canAddLead: boolean;
  onAdded: (leadId: number) => void;
}) {
  const { pending, add } = useAddLead(ctx, onAdded);
  if (!ctx) return <div className="inbox-context-strip" aria-hidden><div className="skeleton" style={{ width: 180, height: 12, borderRadius: 6 }} /></div>;
  const fact =
    ctx.type === "client"
      ? ctx.membership
        ? ctx.membership.name
        : `${memberLabel} since ${since(ctx.since)}`
      : ctx.type === "lead"
        ? ctx.stage ?? "Lead"
        : `Not a ${memberLabel.toLowerCase()} or lead yet`;
  return (
    <div className="inbox-context-strip">
      <span className={`inbox-pill inbox-pill--${ctx.type}`}>{typeLabel(ctx, memberLabel)}</span>
      <span className="inbox-context-strip-fact">{fact}</span>
      {ctx.type !== "unknown" ? (
        <Link href={ctx.href} className="inbox-link">
          Open profile <ArrowUpRight size={13} />
        </Link>
      ) : canAddLead && ctx.email ? (
        <Button size="sm" variant="outline" onClick={add} loading={pending}>
          <UserPlus size={13} /> Add as lead
        </Button>
      ) : null}
    </div>
  );
}
