"use client";

import { usePathname } from "next/navigation";

import {
  Sidebar,
  type SidebarAccount,
  type SidebarUser,
} from "@/components/layout/Sidebar";
import { VocabProvider } from "@/components/providers/VocabProvider";
import type { Vocab } from "@/lib/vocabulary";

const NO_SHELL_PATHS = ["/login", "/change-password", "/select-account"];

export function AppShell({
  user,
  accounts,
  activeTenantId,
  vocab,
  logoSrc,
  businessName,
  children,
}: {
  user: SidebarUser | null;
  accounts: SidebarAccount[];
  activeTenantId: number | null;
  vocab: Vocab;
  logoSrc: string | null;
  businessName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
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
          logoSrc={logoSrc}
          businessName={businessName}
        />
        <main className="app-main">{children}</main>
      </div>
    </VocabProvider>
  );
}
