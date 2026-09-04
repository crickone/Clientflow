"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import {
  Sidebar,
  type SidebarAccount,
  type SidebarUser,
} from "@/components/layout/Sidebar";
import { Logo } from "@/components/ui/Logo";
import { VocabProvider } from "@/components/providers/VocabProvider";
import type { Vocab } from "@/lib/vocabulary";
import type { ThemeMode } from "@/lib/theme";

const NO_SHELL_PATHS = ["/login", "/change-password", "/select-account", "/accept-invite"];

export function AppShell({
  user,
  accounts,
  activeTenantId,
  tenantSlug,
  schedulingMode,
  vocab,
  logoSrc,
  businessName,
  showSetup,
  navBadges,
  themeMode,
  children,
}: {
  user: SidebarUser | null;
  accounts: SidebarAccount[];
  activeTenantId: number | null;
  tenantSlug: string;
  schedulingMode: "appointments" | "timetable";
  vocab: Vocab;
  logoSrc: string | null;
  businessName: string;
  showSetup: boolean;
  /** Nav-row count pills, keyed by href — see Sidebar's renderLink. */
  navBadges?: Record<string, number>;
  themeMode: ThemeMode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  // Desktop nav collapse. Persisted per browser so it survives navigation and
  // reloads; read after mount so the server render stays deterministic.
  const [navCollapsed, setNavCollapsed] = useState(false);
  useEffect(() => {
    try {
      setNavCollapsed(localStorage.getItem("nav-collapsed") === "1");
    } catch {}
  }, []);
  const toggleNavCollapsed = () =>
    setNavCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("nav-collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });

  // Close the mobile drawer whenever the route changes (i.e. on nav).
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  const bare = NO_SHELL_PATHS.some(
    (p) => pathname === p || pathname?.startsWith(`${p}/`),
  );

  if (bare || !user) {
    return <VocabProvider value={vocab}>{children}</VocabProvider>;
  }

  return (
    <VocabProvider value={vocab}>
      <div className="app-shell">
        <Sidebar
          user={user}
          accounts={accounts}
          activeTenantId={activeTenantId}
          tenantSlug={tenantSlug}
          schedulingMode={schedulingMode}
          logoSrc={logoSrc}
          businessName={businessName}
          showSetup={showSetup}
          navBadges={navBadges}
          themeMode={themeMode}
          open={navOpen}
          onClose={() => setNavOpen(false)}
          collapsed={navCollapsed}
          onToggleCollapsed={toggleNavCollapsed}
        />
        {navOpen && <div className="app-backdrop" onClick={() => setNavOpen(false)} />}
        <main className="app-main">
          <div className="app-topbar">
            <button className="app-hamburger" onClick={() => setNavOpen(true)} aria-label="Open menu">
              <Menu size={22} strokeWidth={1.9} />
            </button>
            <Logo src={logoSrc} alt={businessName} height={22} />
          </div>
          {children}
        </main>
      </div>
    </VocabProvider>
  );
}
