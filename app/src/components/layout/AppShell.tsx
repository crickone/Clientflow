"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import {
  Sidebar,
  type SidebarAccount,
  type SidebarUser,
} from "@/components/layout/Sidebar";
import { Logo } from "@/components/ui/Logo";
import { VocabProvider } from "@/components/providers/VocabProvider";
import { GenerationWatcher } from "@/components/content-studio/GenerationWatcher";
import type { Vocab } from "@/lib/vocabulary";
import type { ThemeMode } from "@/lib/theme";
import type { FeatureFlags } from "@/lib/features";
import { isBarePath } from "@/lib/barePaths";

export function AppShell({
  user,
  accounts,
  activeTenantId,
  tenantSlug,
  schedulingMode,
  featureFlags,
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
  /** Modules this business has; a switched-off one is not offered in the nav. */
  featureFlags: FeatureFlags;
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

  /**
   * The mobile drawer is the ONLY navigation a phone has, and it was a plain
   * conditional <div> with a click-to-close backdrop: no Escape, no focus
   * containment, and nothing returning focus when it closed. Opening it left
   * the keyboard behind the overlay, tabbing walked into the page underneath
   * it, and closing it dropped focus to the top of the document.
   *
   * Handled here rather than by swapping in the Radix dialog the app already
   * uses elsewhere, because the drawer IS the sidebar -- the same component,
   * the same nav, the same collapsed state -- on the far side of a media
   * query. Wrapping it in a dialog on phones and not on desktop would mean
   * two mount paths for one piece of navigation.
   */
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!navOpen) return;
    // Where focus goes back TO. Captured at open, because by the time it
    // closes the hamburger may not be what the operator last touched.
    const opener = hamburgerRef.current;

    // Focus the drawer itself rather than its first link: a screen reader
    // announces the region, and the first Tab still lands on that link.
    drawerRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setNavOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const root = drawerRef.current;
      if (!root) return;
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      // Wrap at both ends, and catch the case where focus has escaped the
      // drawer entirely (a click on the page behind it).
      if (e.shiftKey && (active === first || active === root || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    // The page behind a drawer must not scroll under it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [navOpen]);

  const bare = isBarePath(pathname);

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
          featureFlags={featureFlags}
          logoSrc={logoSrc}
          businessName={businessName}
          showSetup={showSetup}
          navBadges={navBadges}
          themeMode={themeMode}
          open={navOpen}
          drawerRef={drawerRef}
          onClose={() => setNavOpen(false)}
          collapsed={navCollapsed}
          onToggleCollapsed={toggleNavCollapsed}
        />
        {navOpen && (
          <div
            className="app-backdrop"
            onClick={() => setNavOpen(false)}
            aria-hidden="true"
          />
        )}
        <main className="app-main">
          <div className="app-topbar">
            <button
              ref={hamburgerRef}
              className="app-hamburger"
              onClick={() => setNavOpen(true)}
              aria-label="Open menu"
              aria-expanded={navOpen}
              aria-controls="app-nav-drawer"
            >
              <Menu size={22} strokeWidth={1.9} />
            </button>
            <Logo src={logoSrc} alt={businessName} height={22} />
          </div>
          {children}
        </main>
        {/* Renders nothing. It watches detached carousel generations started in
            this browser and notifies when they finish -- which has to happen
            ABOVE the page, because the operator is invited to navigate away
            from the editor while the run continues on the server. Idle (the
            usual case) it holds no timer and makes no requests. */}
        <GenerationWatcher />
      </div>
    </VocabProvider>
  );
}
