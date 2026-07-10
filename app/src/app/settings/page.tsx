import Link from "next/link";
import {
  CalendarClock,
  Ban,
  Building2,
  Store,
  Sparkles,
  Package as PackageIcon,
  ChevronRight,
  UserCog,
  Image as ImageIcon,
  Palette,
  MessageCircle,
  Bot,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardLabel } from "@/components/ui/Card";
import { requireAdminPage } from "@/lib/auth";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

function buildSections(vocab: ReturnType<typeof getVocab>) {
  return [
  {
    href: "/settings/business",
    icon: Store,
    title: "Business profile",
    desc: "Your business name, contact, and brief — used to generate content and shown across the app.",
  },
  {
    href: "/settings/venue",
    icon: Building2,
    title: "Venue type",
    desc: "Switch the app vocabulary between a clinic and a gym. Labels only — data is unchanged.",
  },
  {
    href: "/settings/therapies",
    icon: Sparkles,
    title: vocab.services,
    desc: `Add, edit, or deactivate ${vocab.services.toLowerCase()}. Set durations, prices, colours.`,
  },
  {
    href: "/settings/schedule",
    icon: CalendarClock,
    title: "Opening hours",
    desc: "Per-day opening hours, slot length, concurrent bookings, buffers.",
  },
  {
    href: "/settings/blocks",
    icon: Ban,
    title: "Block-out times",
    desc: "Recurring breaks (lunch) and one-off closures (holidays). Hard-blocks bookings.",
  },
  {
    href: "/settings/packages",
    icon: PackageIcon,
    title: `${vocab.plan} types`,
    desc: `Pre-set ${vocab.plan.toLowerCase()} templates (sessions, price, validity) for one-click selling.`,
  },
  {
    href: "/settings/users",
    icon: UserCog,
    title: "Users & permissions",
    desc: "Manage staff and admin accounts. Add, edit, deactivate, reset passwords.",
  },
  {
    href: "/settings/appearance",
    icon: Palette,
    title: "Appearance",
    desc: "Theme the whole app — background & accent colour — and upload the logo shown at the top.",
  },
  {
    href: "/settings/branding",
    icon: ImageIcon,
    title: "Branding",
    desc: "Content Studio fonts, and the same business logo used on intro/outro cards.",
  },
  {
    href: "/settings/integrations/whatsapp",
    icon: MessageCircle,
    title: "WhatsApp",
    desc: "Connect a WhatsApp number to message leads and clients in their thread.",
  },
  {
    href: "/settings/inbox-ai",
    icon: Bot,
    title: "Inbox AI",
    desc: "Auto-reply controls (toggle, categories, confidence) and the tag vocabulary used to triage messages.",
  },
  ];
}

export default async function SettingsIndex() {
  await requireAdminPage();
  const vocab = getVocab(getVenueType());
  const SECTIONS = buildSections(vocab);
  return (
    <div className="app-page" style={{ maxWidth: 880 }}>
      <PageHeader
        eyebrow="Configure"
        title="Settings"
        subtitle={`Tune how the ${vocab.bookings.toLowerCase()} and schedule behave.`}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.href} href={s.href}>
              <Card
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 18,
                  padding: 22,
                  transition: "background 0.15s var(--ease)",
                }}
              >
                <div
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--hairline)",
                    borderRadius: "var(--radius)",
                    width: 44,
                    height: 44,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--text-primary)",
                    flexShrink: 0,
                  }}
                >
                  <Icon size={20} strokeWidth={1.5} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      color: "var(--text-primary)",
                      fontSize: 16,
                      fontWeight: 500,
                    }}
                  >
                    {s.title}
                  </div>
                  <div
                    style={{
                      color: "var(--text-secondary)",
                      fontSize: 13,
                      marginTop: 4,
                    }}
                  >
                    {s.desc}
                  </div>
                </div>
                <ChevronRight size={18} color="var(--text-tertiary)" />
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
