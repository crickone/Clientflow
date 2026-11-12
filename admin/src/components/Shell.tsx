"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useTransition, type ReactNode } from "react";
import {
  Activity,
  Bookmark,
  Dumbbell,
  LayoutDashboard,
  LogOut,
  Menu,
  Rocket,
  Search as SearchIcon,
  ScrollText,
  Settings as SettingsIcon,
  Users,
  X,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { Logo } from "@/components/Logo";
import { CommandK } from "@/components/CommandK";
import { Shortcuts } from "@/components/Shortcuts";
import type { AdminUser } from "@/lib/session";
import { BUILT_IN_VIEWS, type ConsoleView } from "@/lib/views";
import { notify } from "@/lib/toast";
import { deleteViewAction } from "@/app/(console)/views/actions";

// Grouped by what you came to do: look at the fleet, change something, or
// manage the console itself. The mono group labels are the console's
// metadata voice, the same as the dashboard's eyebrows.
const NAV_GROUPS = [
  {
    label: "Fleet",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { href: "/gyms", label: "Businesses", icon: Dumbbell },
      // Every business's alerts in one list; shallow, for skimming.
      { href: "/health", label: "Health", icon: Activity },
    ],
  },
  {
    label: "Operate",
    items: [
      { href: "/provision", label: "Provision", icon: Rocket },
      // Every console action, including refused ones. Both roles can read it.
      { href: "/audit", label: "Audit log", icon: ScrollText },
    ],
  },
  {
    label: "Console",
    items: [
      { href: "/staff", label: "Platform staff", icon: Users },
      { href: "/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];

/** Preserve exact behaviour: DELETE /api/session then hard-navigate to /login. */
async function signOut() {
  await fetch("/api/session", { method: "DELETE" });
  window.location.href = "/login";
}

function ViewLinks({ views }: { views: ConsoleView[] }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [, startTransition] = useTransition();
  const current = search.toString() ? `${pathname}?${search}` : pathname;

  function remove(id: string) {
    startTransition(async () => {
      const r = await deleteViewAction(id);
      if (r.ok) notify.ok("View removed");
      else notify.fail(r.error);
    });
  }

  return (
    <div>
      <div className="nav-group-label">Views</div>
      {[...views, ...BUILT_IN_VIEWS].map((v) => {
        const active = current === v.href;
        const own = views.some((o) => o.id === v.id);
        return (
          <span key={v.id} className="nav-view">
            <Link href={v.href} className={cn("nav-link", active && "nav-link--active")}>
              <Bookmark size={14} strokeWidth={1.75} />
              <span>{v.name}</span>
            </Link>
            {own && (
              <button type="button" className="nav-view-x" aria-label={`Remove ${v.name}`} onClick={() => remove(v.id)}>
                <X size={12} />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function Shell({ user, views, children }: { user: AdminUser; views: ConsoleView[]; children: ReactNode }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  return (
    <div className="app-shell">
      <aside className={cn("app-sidebar", navOpen && "is-open")}>
        <button className="app-sidebar-close" onClick={() => setNavOpen(false)} aria-label="Close menu">
          <X size={20} strokeWidth={2} />
        </button>

        {/* Wordmark */}
        <div style={{ padding: "26px 22px 18px" }}>
          <Logo size={18} />
        </div>

        <button
          type="button"
          className="nav-search"
          onClick={() => window.dispatchEvent(new Event("console:search"))}
        >
          <SearchIcon size={14} strokeWidth={1.75} aria-hidden />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>

        {/* Nav */}
        <nav style={{ padding: "6px 10px", flex: 1, overflowY: "auto" }}>
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname?.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn("nav-link", active && "nav-link--active")}
                  >
                    <Icon size={16} strokeWidth={1.75} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
          <Suspense fallback={null}>
            <ViewLinks views={views} />
          </Suspense>
        </nav>

        {/* User + sign-out */}
        <div
          style={{
            margin: "0 10px 12px",
            padding: "10px 10px 10px 12px",
            borderRadius: 12,
            border: "1px solid var(--grid)",
            background: "var(--surface-1)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "var(--surface-3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-primary)",
              fontFamily: "var(--font-mono), ui-monospace, monospace",
              fontSize: 12,
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
            aria-label="Sign out"
            className="nav-link"
            style={{ padding: 6, borderRadius: "var(--radius)", flex: "0 0 auto" }}
          >
            <LogOut size={15} strokeWidth={1.75} />
          </button>
        </div>
      </aside>

      {navOpen && <div className="app-backdrop" onClick={() => setNavOpen(false)} />}

      <main className="app-main">
        <Shortcuts />
        <CommandK />
        <div className="app-topbar">
          <button className="app-hamburger" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <Menu size={22} strokeWidth={1.9} />
          </button>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />
            <span
              style={{
                fontFamily: "var(--font-nebula), var(--font-heading), system-ui",
                fontSize: 15,
                letterSpacing: "0.02em",
                textTransform: "uppercase",
              }}
            >
              AdonisAgent
            </span>
          </span>
        </div>
        <div className="app-page">{children}</div>
      </main>
    </div>
  );
}
