"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { type CSSProperties, useEffect, useState, useTransition } from "react";
import {
  BarChart3,
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
  Package as PackageIcon,
  Settings as SettingsIcon,
  ShoppingBag,
  Smartphone,
  Sparkles,
  UserCog,
  Users,
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

const NAV: NavEntry[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Sparkles },
  { href: "/communication", label: "Communication", icon: MessagesSquare },
  { href: "/clients", label: "Clients", icon: Users, labelKey: "members" },
  { href: "/appointments", label: "Appointments", icon: CalendarDays, labelKey: "bookings" },
  { href: "/timetable", label: "Timetable", icon: CalendarRange },
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
    label: "Products",
    icon: ShoppingBag,
    children: [
      { href: "/memberships", label: "Memberships", icon: CreditCard },
      { href: "/session-packages", label: "Packages", icon: PackageIcon },
      { href: "/packages", label: "Session bundles", icon: PackageIcon },
      { href: "/vouchers", label: "Gift Vouchers", icon: Gift },
    ],
  },
  { href: "/automations", label: "Automation", icon: Zap },
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
  { href: "/staff", label: "Staff", icon: UserCog, adminOnly: true },
  { href: "/reports", label: "Reports", icon: BarChart3, adminOnly: true },
  { href: "/marketing", label: "Marketing", icon: Megaphone },
  { href: "/cms", label: "Sites", icon: Globe, adminOnly: true },
  { href: "/content-studio", label: "Content Studio", icon: Clapperboard },
  { href: "/training", label: "Training", icon: GraduationCap },
  { href: "/my-app", label: "My App", icon: Smartphone },
  { href: "/settings", label: "Settings", icon: SettingsIcon, adminOnly: true },
];

export function Sidebar({
  user,
  accounts,
  activeTenantId,
  logoSrc,
  businessName,
}: {
  user: SidebarUser;
  accounts: SidebarAccount[];
  activeTenantId: number | null;
  logoSrc: string | null;
  businessName: string;
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
  const visibleNav = NAV.map((e) => {
    if (isGroup(e)) {
      if (e.adminOnly && !isAdmin) return null;
      const children = e.children.filter((c) => !c.adminOnly || isAdmin);
      return children.length ? { ...e, children } : null;
    }
    return !e.adminOnly || isAdmin ? e : null;
  }).filter((e): e is NavEntry => e !== null);

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
        style={{
          ...navRowStyle,
          paddingLeft: indent ? 34 : 13,
          color: active ? "var(--accent)" : "var(--text-secondary)",
          background: active ? "var(--accent-soft)" : "transparent",
        }}
      >
        {active && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              top: 5,
              bottom: 5,
              width: 3,
              background: "var(--accent)",
            }}
          />
        )}
        <Icon size={indent ? 15 : 16} strokeWidth={1.75} />
        <span>{item.labelKey ? vocab[item.labelKey] : item.label}</span>
      </Link>
    );
  }

  return (
    <aside
      style={{
        width: 240,
        minWidth: 240,
        borderRight: "1px solid var(--hairline)",
        background: "var(--surface-1)",
        display: "flex",
        flexDirection: "column",
        position: "sticky",
        top: 0,
        height: "100vh",
      }}
    >
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

      <nav style={{ padding: "12px 8px", flex: 1, overflowY: "auto" }}>
        {visibleNav.map((entry) => {
          if (!isGroup(entry)) return renderLink(entry);

          const Icon = entry.icon;
          const childActive = entry.children.some((c) => pathname?.startsWith(c.href));
          const expanded = openGroups[entry.label] ?? childActive;
          return (
            <div key={entry.label}>
              <button
                onClick={() =>
                  setOpenGroups((s) => ({ ...s, [entry.label]: !expanded }))
                }
                style={{
                  ...navRowStyle,
                  width: "100%",
                  border: "none",
                  cursor: "pointer",
                  background: "transparent",
                  color: childActive ? "var(--text-primary)" : "var(--text-secondary)",
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
              {expanded &&
                entry.children.map((c) => renderLink(c, true))}
            </div>
          );
        })}
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
        <button
          onClick={signOut}
          disabled={signingOut}
          title="Sign out"
          aria-label="Sign out"
          style={{
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: "var(--radius)",
            padding: 6,
            color: "var(--text-secondary)",
            cursor: signingOut ? "default" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.15s var(--ease), color 0.15s var(--ease)",
          }}
        >
          <LogOut size={15} strokeWidth={1.75} />
        </button>
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
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [switching, setSwitching] = useState<number | null>(null);

  function switchTo(tenantId: number) {
    setOpen(false);
    if (tenantId === activeTenantId) return;
    setSwitching(tenantId);
    start(async () => {
      const res = await chooseAccount(tenantId);
      // chooseAccount redirects on success and only returns on failure.
      if (res && !res.ok) {
        toast.error(res.error);
        setSwitching(null);
      }
    });
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch account"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          background: open ? "var(--surface-2)" : "transparent",
          border: "1px solid",
          borderColor: open ? "var(--hairline)" : "transparent",
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

      {open && (
        <>
          {/* click-away overlay */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
          />
          <div
            role="menu"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              right: 0,
              zIndex: 41,
              background: "var(--surface-1)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              boxShadow: "0 8px 28px rgba(0,0,0,0.28)",
              padding: 6,
            }}
          >
            {accounts.map((a) => {
              const active = a.tenantId === activeTenantId;
              const busy = pending && switching === a.tenantId;
              return (
                <button
                  key={a.tenantId}
                  role="menuitem"
                  onClick={() => switchTo(a.tenantId)}
                  disabled={pending}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    borderRadius: "var(--radius)",
                    padding: "8px 8px",
                    cursor: pending ? "default" : "pointer",
                    color: "var(--text-primary)",
                    fontFamily: "inherit",
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      flexShrink: 0,
                      display: "inline-flex",
                      justifyContent: "center",
                      color: "var(--accent)",
                    }}
                  >
                    {active && <Check size={14} strokeWidth={2} />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 13,
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.name}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontFamily: "var(--font-mono), ui-monospace, monospace",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "var(--text-tertiary)",
                      }}
                    >
                      {busy ? "Opening…" : a.role}
                    </span>
                  </span>
                </button>
              );
            })}
            <div
              style={{
                height: 1,
                background: "var(--hairline)",
                margin: "6px 4px",
              }}
            />
            <Link
              href="/select-account"
              onClick={() => setOpen(false)}
              role="menuitem"
              style={{
                display: "block",
                padding: "8px 8px",
                borderRadius: "var(--radius)",
                fontSize: 12,
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono), ui-monospace, monospace",
              }}
            >
              Manage accounts →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
