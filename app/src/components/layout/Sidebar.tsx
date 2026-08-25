"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { type CSSProperties, useEffect, useState, useTransition } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { EASE, DUR } from "@/lib/motion";
import { Tooltip } from "@/components/ui/Tooltip";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import type { ThemeMode } from "@/lib/theme";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/DropdownMenu";
import {
  BarChart3,
  Binoculars,
  Bot,
  Calendar,
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
  Rocket,
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
import { LogoLoader, finishSwitchLoader } from "@/components/ui/LogoLoader";
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
  /** Show a small nudge dot at the row's right edge. */
  dot?: boolean;
};
type NavGroup = {
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
  /** Children may themselves be groups — the sidebar renders up to two levels of nesting. */
  children: NavEntry[];
};
type NavEntry = NavLink | NavGroup;

const isGroup = (e: NavEntry): e is NavGroup => "children" in e;

/** True if `item`'s href matches (or is the route family of) the current path. */
function isActiveLink(item: NavLink, pathname: string | null): boolean {
  if (item.href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  return item.exact ? pathname === item.href : !!pathname?.startsWith(item.href);
}

/** True if any link anywhere under `group` — at any nesting depth — is the active route. */
function groupHasActiveDescendant(group: NavGroup, pathname: string | null): boolean {
  return group.children.some((c) =>
    isGroup(c) ? groupHasActiveDescendant(c, pathname) : isActiveLink(c, pathname)
  );
}

/** The flagship item — pinned above Dashboard, rendered prominently, not part of a group. */
const ADONIS_LINK: NavLink = { href: "/adonis", label: "Adonis", icon: Bot };
const DASHBOARD_LINK: NavLink = { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard };

/** Five collapsible top-level groups, folded by default (see `openGroups`). */
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Clients",
    icon: Users,
    children: [
      { href: "/clients", label: "Clients", icon: Users, labelKey: "members" },
      { href: "/leads", label: "Leads", icon: Sparkles },
      { href: "/communication", label: "Communication", icon: MessagesSquare },
      { href: "/calendar", label: "Calendar", icon: CalendarClock },
      { href: "/appointments", label: "Appointments", icon: CalendarDays, labelKey: "bookings", mode: "appointments" },
    ],
  },
  {
    label: "Coaching",
    icon: GraduationCap,
    children: [
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
    label: "Business",
    icon: ShoppingBag,
    children: [
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
    label: "Marketing",
    icon: Megaphone,
    children: [
      // Campaign Engine hub (Slice 1): Adonis builds a full seasonal kit
      // (offer/blog/social/email/ads/video script) here, one asset at a
      // time. Admin-only for the same reason the email Campaigns group
      // below is — this page is requireAdminPage'd and its detail page's
      // Launch action publishes content live. (The build runs through
      // Adonis's chat on /adonis, which is staff-visible, but only an admin
      // ever reaches the Build-campaign links from these admin-only pages.)
      { href: "/marketing/campaigns", label: "Marketing", icon: Megaphone, adminOnly: true },
      // Campaign Engine Slice 3: the year-map of Irish marketing dates +
      // seasons overlaid with real campaigns, plus the AI radar "coming up"
      // rail. Same admin-only reasoning as "Marketing" above (this page is
      // requireAdminPage'd; Build-campaign from here opens Adonis on /adonis).
      { href: "/marketing/calendar", label: "Seasonal calendar", icon: Calendar, adminOnly: true },
      // Market Research P1 (Task 10): the competitor-tracking dashboard —
      // ranked list, rating/review trends, a change feed, per-competitor
      // detail. Admin-gated (requireAdminPage) for the same reason as the
      // two Campaign Engine links above — keep the nav consistent.
      { href: "/marketing/research", label: "Research", icon: Binoculars, adminOnly: true },
      { href: "/cms", label: "Sites", icon: Globe, adminOnly: true },
      { href: "/content-studio", label: "Content Studio", icon: Clapperboard },
      {
        label: "Email campaigns",
        icon: Send,
        // Admin-only: campaign pages/actions are all requireAdmin (credit spend,
        // contact-list management, deliverability) — keep the nav consistent so
        // staff don't see links that redirect to /dashboard.
        adminOnly: true,
        children: [
          { href: "/campaigns", label: "Campaigns", icon: Send, exact: true },
          { href: "/campaigns/contacts", label: "Contacts", icon: Send },
          { href: "/campaigns/domains", label: "Sending domains", icon: Send, adminOnly: true },
        ],
      },
    ],
  },
  {
    label: "System",
    icon: SettingsIcon,
    children: [
      { href: "/my-app", label: "My App", icon: Smartphone },
      { href: "/training", label: "Training", icon: GraduationCap, tenants: ["renova"] },
      { href: "/settings", label: "Settings", icon: SettingsIcon, adminOnly: true },
      // Dismissible self-onboarding checklist — admin-only, hidden once complete (showSetup).
      { href: "/setup", label: "Set up", icon: Rocket, adminOnly: true, dot: true },
    ],
  },
];

/**
 * Per-nesting-level sibling labels for every group, computed once from the
 * static NAV_GROUPS tree. Drives the sidebar's accordion behaviour: opening a
 * group collapses its SAME-LEVEL siblings only — so opening a nested sub-group
 * never collapses its parent (which would hide the child). See renderEntry's
 * onClick. (Group labels are unique across the tree — openGroups is already
 * keyed by label, so this mirrors that assumption.)
 */
const GROUP_SIBLINGS: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {};
  const walk = (entries: NavEntry[]) => {
    const groupLabels = entries.filter(isGroup).map((g) => g.label);
    for (const e of entries) {
      if (isGroup(e)) {
        map[e.label] = groupLabels.filter((l) => l !== e.label);
        walk(e.children);
      }
    }
  };
  walk(NAV_GROUPS);
  return map;
})();

export function Sidebar({
  user,
  accounts,
  activeTenantId,
  tenantSlug,
  schedulingMode,
  logoSrc,
  businessName,
  showSetup,
  themeMode,
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
  showSetup: boolean;
  themeMode: ThemeMode;
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
    (!l.mode || l.mode === schedulingMode) &&
    (l.href !== "/setup" || showSetup);
  const filterEntry = (e: NavEntry): NavEntry | null => {
    if (isGroup(e)) {
      if (e.adminOnly && !isAdmin) return null;
      // Recurse first — a nested group (e.g. Nutrition) is itself filtered by
      // the same rule, so it disappears if none of ITS children survive.
      const children = e.children.map(filterEntry).filter((c): c is NavEntry => c !== null);
      return children.length ? { ...e, children } : null;
    }
    return linkAllowed(e) ? e : null;
  };
  const showAdonis = linkAllowed(ADONIS_LINK);
  const showDashboard = linkAllowed(DASHBOARD_LINK);
  const visibleGroups = NAV_GROUPS.map((g) => filterEntry(g) as NavGroup | null).filter(
    (g): g is NavGroup => g !== null
  );

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

  /** Left indent scales with nesting depth (0 = top level, matches the old indent/no-indent split at depth 1). */
  const indentFor = (depth: number) => 13 + depth * 21;

  function renderLink(item: NavLink, depth = 0) {
    const active = isActiveLink(item, pathname);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn("nav-link", active && "nav-link--active")}
        style={{
          ...navRowStyle,
          paddingLeft: indentFor(depth),
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
        <Icon size={depth === 0 ? 16 : 15} strokeWidth={1.75} />
        <span>{item.labelKey ? vocab[item.labelKey] : item.label}</span>
        {item.dot && (
          <span
            aria-hidden
            style={{
              marginLeft: "auto",
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--warning, #f59e0b)",
              flexShrink: 0,
            }}
          />
        )}
      </Link>
    );
  }

  /**
   * The pinned Adonis row — visually distinct from every other row via accent
   * text/icon + bold weight at ALL times (it's the product's flagship entry
   * point, not a normal nav item). The accent-tinted BACKGROUND, however, is
   * applied ONLY when active (on /adonis/**) — like any selected nav row — so
   * it doesn't read as "selected" while you're on a different route. Inactive,
   * `nav-link` supplies the standard hover background for affordance (the inline
   * accent colour wins over nav-link's text colour, so the flagship stays accent
   * on hover); the shared nav-active-bar still marks the active state.
   */
  function renderAdonisLink(item: NavLink) {
    const active = isActiveLink(item, pathname);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        className="nav-link"
        style={{
          ...navRowStyle,
          paddingLeft: indentFor(0),
          color: "var(--accent)",
          fontSize: 14,
          fontWeight: 800,
          ...(active ? { background: "var(--accent-soft)" } : {}),
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
        <Icon size={18} strokeWidth={2} />
        <span>{item.label}</span>
      </Link>
    );
  }

  /** Recursive: an entry is either a leaf link or a group whose children may themselves be groups. */
  function renderEntry(entry: NavEntry, depth: number) {
    if (!isGroup(entry)) return renderLink(entry, depth);

    const Icon = entry.icon;
    const childActive = groupHasActiveDescendant(entry, pathname);
    const expanded = openGroups[entry.label] ?? childActive;
    return (
      <div key={entry.label}>
        <button
          onClick={() =>
            setOpenGroups((s) => {
              // Accordion: opening a group collapses its same-level siblings;
              // clicking an already-open group just collapses it. Setting a
              // sibling explicitly `false` overrides the childActive auto-open
              // fallback in `expanded` above, so the active-route group also
              // closes when you open a different one (what the user expects).
              if (expanded) return { ...s, [entry.label]: false };
              const next = { ...s };
              for (const sib of GROUP_SIBLINGS[entry.label] ?? []) next[sib] = false;
              next[entry.label] = true;
              return next;
            })
          }
          className="nav-link"
          style={{
            ...navRowStyle,
            width: "100%",
            border: "none",
            cursor: "pointer",
            paddingLeft: indentFor(depth),
            ...(childActive ? { color: "var(--text-primary)" } : {}),
          }}
        >
          <Icon size={depth === 0 ? 16 : 15} strokeWidth={1.75} />
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
        {expanded && entry.children.map((c) => renderEntry(c, depth + 1))}
      </div>
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
        {(showAdonis || showDashboard) && (
          <div
            style={{
              marginBottom: 10,
              paddingBottom: 10,
              borderBottom: "1px solid var(--hairline)",
            }}
          >
            {showAdonis && renderAdonisLink(ADONIS_LINK)}
            {showDashboard && renderLink(DASHBOARD_LINK)}
          </div>
        )}
        {visibleGroups.map((group) => renderEntry(group, 0))}
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
        <ThemeToggle initialMode={themeMode} />
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
    const startedAt = Date.now();
    start(async () => {
      const res = await chooseAccount(tenantId);
      if (!res.ok) {
        toast.error(res.error);
        setSwitching(null);
        return;
      }
      // Hold the branded loader for a full draw cycle, then hard-reload so the
      // ROOT layout re-renders with the new tenant's theme, logo and nav.
      await finishSwitchLoader(startedAt);
    });
  }

  return (
    <>
      {switching !== null && <LogoLoader />}
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
    </>
  );
}
