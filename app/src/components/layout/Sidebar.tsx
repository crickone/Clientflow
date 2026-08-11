"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { type CSSProperties, useEffect, useState, useTransition } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { EASE, DUR } from "@/lib/motion";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/DropdownMenu";
import {
  BarChart3,
  Bot,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  ChevronsUpDown,
  Clapperboard,
  Dumbbell,
  GraduationCap,
  CreditCard,
  Gift,
  Globe,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessagesSquare,
  Salad,
  Send,
  Package as PackageIcon,
  Settings as SettingsIcon,
  ShoppingBag,
  Smartphone,
  Sparkles,
  UserCog,
  Users,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { chooseAccount } from "@/app/select-account/actions";
import { useVocab } from "@/components/providers/VocabProvider";
import { Logo } from "@/components/ui/Logo";
import type { Vocab } from "@/lib/vocabulary";

export type SidebarUser = {
  id: number;
  email: string;
  name: string | null;
  role: "admin" | "staff";
};

/** A clinic the signed-in identity can switch into (plain, client-safe shape). */
export type SidebarAccount = {
  tenantId: number;
  name: string;
  role: "admin" | "staff";
};

type NavLink = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
  /** Restrict this item to specific tenant slugs (e.g. Renova-only modules). */
  tenants?: string[];
  /** Show only when this scheduling mode is active (Appointments vs Timetable). */
  mode?: "appointments" | "timetable";
  /** Highlight only on an exact path match (not startsWith). */
  exact?: boolean;
  /** When set, the label is taken from the active venue vocabulary. */
  labelKey?: keyof Vocab;
};
type NavGroup = {
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
  children: NavLink[];
};
type NavEntry = NavLink | NavGroup;

const isGroup = (e: NavEntry): e is NavGroup => "children" in e;

/** A labelled block of nav entries. An empty heading = the top (unlabelled) block. */
type NavSection = { heading?: string; items: NavEntry[] };

const NAV: NavSection[] = [
  {
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    heading: "Clients",
    items: [
      { href: "/clients", label: "Clients", icon: Users, labelKey: "members" },
      { href: "/leads", label: "Leads", icon: Sparkles },
      { href: "/communication", label: "Communication", icon: MessagesSquare },
      { href: "/calendar", label: "Calendar", icon: CalendarClock },
      { href: "/appointments", label: "Appointments", icon: CalendarDays, labelKey: "bookings", mode: "appointments" },
    ],
  },
  {
    heading: "Coaching",
    items: [
      { href: "/timetable", label: "Timetable", icon: CalendarRange, mode: "timetable" },
      { href: "/attendance", label: "Attendance", icon: ClipboardCheck },
      {
        label: "Nutrition",
        icon: Salad,
        children: [
          { href: "/nutrition", label: "Plans", icon: Salad, exact: true },
          { href: "/nutrition/meals", label: "Meals", icon: Salad },
          { href: "/nutrition/foods", label: "Foods", icon: Salad },
        ],
      },
      {
        label: "Workout",
        icon: Dumbbell,
        children: [
          { href: "/workout", label: "Programs", icon: Dumbbell, exact: true },
          { href: "/workout/workouts", label: "Workouts", icon: Dumbbell },
          { href: "/workout/exercises", label: "Exercise Library", icon: Dumbbell },
          { href: "/workout/circuits", label: "Circuits", icon: Dumbbell },
        ],
      },
      {
        label: "Forms",
        icon: ClipboardList,
        children: [
          { href: "/forms/initial", label: "Initial Questionnaire", icon: ClipboardList },
          { href: "/forms/checkin", label: "Check In Form", icon: ClipboardList },
          { href: "/forms/habits", label: "Daily Habits", icon: ClipboardList },
          { href: "/forms/contact", label: "Contact Forms", icon: ClipboardList },
          { href: "/forms/terms", label: "Terms & Conditions", icon: ClipboardList },
        ],
      },
      { href: "/automations", label: "Automation", icon: Zap },
    ],
  },
  {
    heading: "Business",
    items: [
      {
        label: "Products",
        icon: ShoppingBag,
        children: [
          { href: "/memberships", label: "Memberships", icon: CreditCard },
          { href: "/session-packages", label: "Packages", icon: PackageIcon },
          { href: "/packages", label: "Session bundles", icon: PackageIcon },
          { href: "/vouchers", label: "Gift Vouchers", icon: Gift },
        ],
      },
      { href: "/staff", label: "Staff", icon: UserCog, adminOnly: true },
      { href: "/reports", label: "Reports", icon: BarChart3, adminOnly: true },
    ],
  },
  {
    heading: "AI",
    items: [
      { href: "/agents", label: "Agents", icon: Bot, adminOnly: true },
    ],
  },
  {
    heading: "Marketing",
    items: [
      { href: "/marketing", label: "Marketing", icon: Megaphone },
      { href: "/cms", label: "Sites", icon: Globe, adminOnly: true },
      { href: "/content-studio", label: "Content Studio", icon: Clapperboard },
      {
        label: "Campaigns",
        icon: Send,
        children: [
          { href: "/campaigns", label: "Campaigns", icon: Send, exact: true },
          { href: "/campaigns/contacts", label: "Contacts", icon: Send },
          { href: "/campaigns/domains", label: "Sending domains", icon: Send, adminOnly: true },
        ],
      },
    ],
  },
  {
    heading: "System",
    items: [
      { href: "/my-app", label: "My App", icon: Smartphone },
      { href: "/training", label: "Training", icon: GraduationCap, tenants: ["renova"] },
      { href: "/settings", label: "Settings", icon: SettingsIcon, adminOnly: true },
    ],
  },
];

export function Sidebar({
  user,
  accounts,
  activeTenantId,
  tenantSlug,
  schedulingMode,
  logoSrc,
  businessName,
  open = false,
  onClose,
}: {
  user: SidebarUser;
  accounts: SidebarAccount[];
  activeTenantId: number | null;
  tenantSlug: string;
  schedulingMode: "appointments" | "timetable";
  logoSrc: string | null;
  businessName: string;
  open?: boolean;
  onClose?: () => void;
}) {
  const vocab = useVocab();
  const router = useRouter();
  const pathname = usePathname();
  const [now, setNow] = useState<Date | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const isAdmin = user.role === "admin";
  const linkAllowed = (l: NavLink) =>
    (!l.adminOnly || isAdmin) &&
    (!l.tenants || l.tenants.includes(tenantSlug)) &&
    (!l.mode || l.mode === schedulingMode);
  const filterEntry = (e: NavEntry): NavEntry | null => {
    if (isGroup(e)) {
      if (e.adminOnly && !isAdmin) return null;
      const children = e.children.filter(linkAllowed);
      return children.length ? { ...e, children } : null;
    }
    return linkAllowed(e) ? e : null;
  };
  const visibleSections = NAV.map((section) => ({
    heading: section.heading,
    items: section.items.map(filterEntry).filter((e): e is NavEntry => e !== null),
  })).filter((s) => s.items.length > 0);

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const navRowStyle: CSSProperties = {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "9px 13px",
    margin: "1px 0",
    borderRadius: "var(--radius)",
    fontFamily: "var(--font-body), sans-serif",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0",
    transition: "background 0.15s var(--ease), color 0.15s var(--ease)",
  };

  function renderLink(item: NavLink, indent = false) {
    const active =
      item.href === "/dashboard"
        ? pathname === "/dashboard" || pathname === "/"
        : item.exact
          ? pathname === item.href
          : pathname?.startsWith(item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn("nav-link", active && "nav-link--active")}
        style={{
          ...navRowStyle,
          paddingLeft: indent ? 34 : 13,
        }}
      >
        {active && (
          <motion.span
            layoutId="nav-active-bar"
            aria-hidden
            style={{ position: "absolute", left: 0, top: 5, bottom: 5, width: 3, background: "var(--accent)" }}
            transition={{ duration: DUR.base, ease: [...EASE] }}
          />
        )}
        <Icon size={indent ? 15 : 16} strokeWidth={1.75} />
        <span>{item.labelKey ? vocab[item.labelKey] : item.label}</span>
      </Link>
    );
  }

  return (
    <aside className={`app-sidebar${open ? " is-open" : ""}`}>
      <button
        className="app-sidebar-close"
        onClick={onClose}
        aria-label="Close menu"
      >
        <X size={20} strokeWidth={2} />
      </button>
      <div
        style={{
          padding: "20px 16px 24px",
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        {accounts.length >= 2 ? (
          <AccountSwitcher
            accounts={accounts}
            activeTenantId={activeTenantId}
            logoSrc={logoSrc}
            businessName={businessName}
          />
        ) : (
          <div style={{ padding: "4px 4px 0" }}>
            <Logo src={logoSrc} alt={businessName} height={24} />
          </div>
        )}
      </div>

      <nav style={{ padding: "8px 8px 12px", flex: 1, overflowY: "auto" }}>
        {visibleSections.map((section, si) => (
          <div key={section.heading ?? `top-${si}`} style={{ marginTop: si === 0 ? 0 : 14 }}>
            {section.heading && (
              <div
                style={{
                  padding: "6px 13px 5px",
                  fontSize: 9.5,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: "var(--text-tertiary)",
                  fontFamily: "var(--font-mono), ui-monospace, monospace",
                  opacity: 0.6,
                }}
              >
                {section.heading}
              </div>
            )}
            {section.items.map((entry) => {
              if (!isGroup(entry)) return renderLink(entry);

              const Icon = entry.icon;
              const childActive = entry.children.some((c) => pathname?.startsWith(c.href));
              const expanded = openGroups[entry.label] ?? childActive;
              return (
                <div key={entry.label}>
                  <button
                    onClick={() => setOpenGroups((s) => ({ ...s, [entry.label]: !expanded }))}
                    className="nav-link"
                    style={{
                      ...navRowStyle,
                      width: "100%",
                      border: "none",
                      cursor: "pointer",
                      ...(childActive ? { color: "var(--text-primary)" } : {}),
                    }}
                  >
                    <Icon size={16} strokeWidth={1.75} />
                    <span style={{ flex: 1, textAlign: "left" }}>{entry.label}</span>
                    <ChevronDown
                      size={14}
                      style={{
                        transition: "transform 0.15s var(--ease)",
                        transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
                        opacity: 0.6,
                      }}
                    />
                  </button>
                  {expanded && entry.children.map((c) => renderLink(c, true))}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      <div
        style={{
          padding: "14px 16px",
          borderTop: "1px solid var(--hairline)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "var(--radius)",
            background: "var(--surface-2)",
            border: "1px solid var(--grid)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-primary)",
            fontFamily: "var(--font-mono), ui-monospace, monospace",
            fontSize: 12,
            fontWeight: 400,
            flexShrink: 0,
          }}
        >
          {(user.name?.[0] ?? user.email[0] ?? "?").toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: "var(--text-primary)",
              fontSize: 13,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={user.email}
          >
            {user.name || user.email}
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono), ui-monospace, monospace",
              color: "var(--text-tertiary)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            {user.role}
          </div>
        </div>
        <Tooltip label="Sign out">
          <button
            onClick={signOut}
            disabled={signingOut}
            aria-label="Sign out"
            className="nav-link"
            style={{
              border: "1px solid transparent",
              borderRadius: "var(--radius)",
              padding: 6,
              cursor: signingOut ? "default" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <LogOut size={15} strokeWidth={1.75} />
          </button>
        </Tooltip>
      </div>

      <div
        style={{
          padding: "10px 20px 16px",
          borderTop: "1px solid var(--grid)",
          color: "var(--text-tertiary)",
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          fontSize: 11,
        }}
      >
        {now ? (
          <>
            <div style={{ color: "var(--text-secondary)", fontWeight: 500 }}>
              {now.toLocaleDateString("en-IE", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </div>
            <div>
              {now.toLocaleTimeString("en-IE", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </div>
          </>
        ) : (
          <div>—</div>
        )}
      </div>
    </aside>
  );
}

/**
 * Brand-header account switcher, shown only when the identity belongs to ≥2
 * clinics. Clicking a clinic calls chooseAccount (which re-validates membership
 * server-side and redirects to /dashboard for the new tenant). "Manage accounts"
 * links to the full selector. Single-clinic users never see this — the Sidebar
 * renders the plain Logo instead.
 */
function AccountSwitcher({
  accounts,
  activeTenantId,
  logoSrc,
  businessName,
}: {
  accounts: SidebarAccount[];
  activeTenantId: number | null;
  logoSrc: string | null;
  businessName: string;
}) {
  const [pending, start] = useTransition();
  const [switching, setSwitching] = useState<number | null>(null);

  function switchTo(tenantId: number) {
    if (tenantId === activeTenantId) return;
    setSwitching(tenantId);
    start(async () => {
      const res = await chooseAccount(tenantId);
      if (!res.ok) {
        toast.error(res.error);
        setSwitching(null);
        return;
      }
      // Full reload so the ROOT layout re-renders with the new tenant's theme,
      // logo and nav (a soft nav would keep the previous tenant's chrome).
      window.location.assign("/dashboard");
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={pending}
          aria-label="Switch account"
          className="account-trigger"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            borderRadius: "var(--radius)",
            padding: "8px 10px",
            cursor: pending ? "default" : "pointer",
            textAlign: "left",
            transition: "background 0.15s var(--ease), border-color 0.15s var(--ease)",
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            <Logo src={logoSrc} alt={businessName} height={24} />
          </span>
          <ChevronsUpDown
            size={15}
            strokeWidth={1.75}
            style={{ color: "var(--text-tertiary)", flexShrink: 0 }}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" style={{ width: "var(--radix-dropdown-menu-trigger-width)" }}>
        {accounts.map((a) => {
          const active = a.tenantId === activeTenantId;
          const busy = pending && switching === a.tenantId;
          return (
            <DropdownMenuItem
              key={a.tenantId}
              onSelect={(e) => {
                e.preventDefault();
                switchTo(a.tenantId);
              }}
              style={{ color: "var(--text-primary)" }}
            >
              <span style={{ width: 16, flexShrink: 0, display: "inline-flex", justifyContent: "center", color: "var(--accent)" }}>
                {active && <Check size={14} strokeWidth={2} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.name}
                </span>
                <span style={{ display: "block", fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>
                  {busy ? "Opening…" : a.role}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 12 }}>
          <Link href="/select-account">Manage accounts →</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
