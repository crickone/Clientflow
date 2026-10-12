import Link from "next/link";
import {
  MapPin,
  CalendarClock,
  Ban,
  Building2,
  Store,
  Sparkles,
  Package as PackageIcon,
  ChevronRight,
  UserCog,
  Image as ImageIcon,
  LayoutTemplate,
  MessageCircle,
  Mail,
  Bot,
  KeyRound,
  Megaphone,
  PhoneOutgoing,
  Rocket,
  LayoutDashboard,
  CreditCard,
  Workflow,
  Scale,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";
import { getGoogleBusinessConnection } from "@/lib/google/business";
import { isMetaConnected } from "@/lib/social/publisher";
import { facebookConfigured } from "@/lib/facebook/oauth";
import { isWhatsAppConfigured } from "@/lib/whatsapp/config";
import { isGmailConnected } from "@/lib/gmail";
import { isInBodyConnected } from "@/lib/inbody/connection";

export const dynamic = "force-dynamic";

type Status = "connected" | "not-connected" | null;

interface Item {
  href: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  status?: Status;
}

/** A status read must never take the Settings page down with it. */
function safe(fn: () => boolean): Status {
  try {
    return fn() ? "connected" : "not-connected";
  } catch {
    return null;
  }
}

function buildGroups(vocab: ReturnType<typeof getVocab>, tenantId: number): { title: string; desc: string; items: Item[] }[] {
  return [
    {
      title: "Your business",
      desc: "Who you are and how the account is set up.",
      items: [
        { href: "/setup", icon: Rocket, title: "Set-up guide", desc: "Everything you need to get the account fully up and running." },
        { href: "/settings/business", icon: Store, title: "Business profile", desc: "Name, contact details and the brief Adonis writes from." },
        { href: "/settings/venue", icon: Building2, title: "Venue type", desc: "Clinic or gym wording across the app, and how you schedule." },
      ],
    },
    {
      title: `${vocab.bookings} and ${vocab.services.toLowerCase()}`,
      desc: "What you sell, when you're open, and how leads move.",
      items: [
        { href: "/settings/therapies", icon: Sparkles, title: vocab.services, desc: `Add or edit ${vocab.services.toLowerCase()}: durations, prices, colours.` },
        { href: "/settings/schedule", icon: CalendarClock, title: "Opening hours", desc: "Hours per day, slot length, buffers and overlap." },
        { href: "/settings/blocks", icon: Ban, title: "Block-out times", desc: "Lunch breaks, holidays and other closures." },
        { href: "/settings/packages", icon: PackageIcon, title: `${vocab.plan} types`, desc: `Ready-made ${vocab.plan.toLowerCase()}s to sell in one click.` },
        { href: "/settings/pipeline", icon: Workflow, title: "Lead pipeline", desc: "The stages leads move through on the leads board." },
      ],
    },
    {
      title: "Brand and content",
      desc: "How your posts, ads and dashboard look.",
      items: [
        { href: "/settings/branding", icon: ImageIcon, title: "Branding", desc: "Your logo and Content Studio fonts." },
        { href: "/settings/design", icon: LayoutTemplate, title: "Design direction", desc: "The look Adonis designs your posts and ads in." },
        { href: "/settings/dashboard", icon: LayoutDashboard, title: "Dashboard widgets", desc: "Which numbers your staff can see on the dashboard." },
      ],
    },
    {
      title: "Connections",
      desc: "The other tools and accounts Adonis works with.",
      items: [
        { href: "/settings/integrations/google", icon: MapPin, title: "Google", desc: "Business Profile, reviews, Search Console and Analytics.", status: safe(() => getGoogleBusinessConnection(tenantId) !== null) },
        { href: "/settings/integrations/facebook", icon: Megaphone, title: "Facebook and Instagram", desc: "Posting, messages, Lead Ads and the Ads manager.", status: safe(() => facebookConfigured() && isMetaConnected(tenantId)) },
        { href: "/settings/integrations/whatsapp", icon: MessageCircle, title: "WhatsApp", desc: "Message leads and clients from their conversation.", status: safe(() => isWhatsAppConfigured()) },
        { href: "/settings/email", icon: Mail, title: "Email", desc: "Send from your own Gmail or your own domain.", status: safe(() => isGmailConnected(tenantId)) },
        { href: "/settings/integrations/inbody", icon: Scale, title: "InBody", desc: "Body-composition scans saved to each client and shown in their app.", status: safe(() => isInBodyConnected(tenantId)) },
        { href: "/settings/voice", icon: PhoneOutgoing, title: "Voice agent", desc: "The AI that phones your new leads." },
        { href: "/settings/inbox-ai", icon: Bot, title: "Inbox AI", desc: "Automatic replies and how messages are sorted." },
        { href: "/settings/api-keys", icon: KeyRound, title: "API keys", desc: "Let other tools (Zapier, Make, lead forms) send leads in." },
      ],
    },
    {
      title: "Team and account",
      desc: "Who can log in, and your plan.",
      items: [
        { href: "/settings/users", icon: UserCog, title: "Users and permissions", desc: "Staff and admin accounts, invites and passwords." },
        { href: "/settings/billing", icon: CreditCard, title: "Billing", desc: "Your AdonisAgent plan, payment card and invoices." },
      ],
    },
  ];
}

export default async function SettingsIndex() {
  await requireAdminPage();
  const vocab = getVocab(getVenueType());
  const tenantId = getCurrentMembership()?.tenant.id ?? 0;
  const groups = buildGroups(vocab, tenantId);
  return (
    <div className="app-page">
      <PageHeader eyebrow="Configure" title="Settings" subtitle="How your account, bookings, brand and connections are set up." />
      <div className="set-groups">
        {groups.map((g, gi) => (
          <section key={g.title} className="set-group" aria-labelledby={`set-g${gi}`}>
            <div className="set-group-head">
              <h2 className="set-group-title" id={`set-g${gi}`}>
                {g.title}
              </h2>
              <p className="set-group-desc">{g.desc}</p>
            </div>
            <ul className="set-list">
              {g.items.map((s) => {
                const Icon = s.icon;
                return (
                  <li key={s.href}>
                    <Link href={s.href} className="set-row">
                      <span className="set-icon" aria-hidden>
                        <Icon size={17} strokeWidth={1.7} />
                      </span>
                      <span className="set-text">
                        <span className="set-title">{s.title}</span>
                        <span className="set-desc">{s.desc}</span>
                      </span>
                      {/* Always rendered so the arrow stays in its column on rows without a status. */}
                      <span className={s.status ? `set-status is-${s.status}` : "set-status-none"}>
                        {s.status === "connected" ? "Connected" : s.status === "not-connected" ? "Not connected" : null}
                      </span>
                      <ChevronRight size={16} className="set-chev" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
