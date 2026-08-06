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
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

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
          open={navOpen}
          onClose={() => setNavOpen(false)}
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
