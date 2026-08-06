"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Dumbbell,
  LayoutDashboard,
  LogOut,
  Menu,
  Rocket,
  Settings as SettingsIcon,
  X,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { Logo } from "@/components/Logo";
import type { AdminUser } from "@/lib/session";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/gyms", label: "Gyms", icon: Dumbbell },
  { href: "/provision", label: "Provision", icon: Rocket },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

/** Preserve exact behaviour: DELETE /api/session then hard-navigate to /login. */
async function signOut() {
  await fetch("/api/session", { method: "DELETE" });
  window.location.href = "/login";
}

export function Shell({ user, children }: { user: AdminUser; children: ReactNode }) {
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
        <div style={{ padding: "22px 18px 20px", borderBottom: "1px solid var(--hairline)" }}>
          <Logo size={18} />
        </div>

        {/* Nav */}
        <nav style={{ padding: "10px 8px", flex: 1, overflowY: "auto" }}>
          {NAV.map((item) => {
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
                {active && (
                  <span
                    aria-hidden
                    style={{ position: "absolute", left: 0, top: 5, bottom: 5, width: 3, background: "var(--accent)", borderRadius: 2 }}
                  />
                )}
                <Icon size={16} strokeWidth={1.75} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User + sign-out */}
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
              Admin
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
              ClientFlow
            </span>
          </span>
        </div>
        <div className="app-page">{children}</div>
      </main>
    </div>
  );
}
