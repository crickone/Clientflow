import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { ClientAppFrame } from "@/components/clientapp/ClientAppFrame";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { MotionRoot } from "@/components/motion/MotionRoot";
import {
  getCurrentMembership,
  getSessionUser,
  listActiveMemberships,
} from "@/lib/auth";
import { getClientSession } from "@/lib/clientAuth";
import type { SidebarAccount } from "@/components/layout/Sidebar";
import { resolveCurrentTenant } from "@/lib/db/tenant";
import { getTheme, getVenueType, getSchedulingMode } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";
import { DEFAULT_THEME, themeCss } from "@/lib/theme";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getChromeLogoSrc } from "@/lib/branding";
import { getBilling } from "@/lib/billing/engine";
import { PastDueBanner } from "@/components/billing/PastDueBanner";
// Side-effect import: boots the daily automation scheduler (birthdays etc.) on
// the server. This is a nodejs-only server component, so better-sqlite3 stays
// out of the edge bundle. Guarded internally against duplicate timers.
import "@/lib/automations/scheduler";
import {
  bebasNeue,
  body,
  clashDisplay,
  familjen,
  heading,
  inter,
  manrope,
  mono,
  nebula,
  nebulaHollow,
  playfairDisplay,
  spaceGrotesk,
} from "./fonts";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  // No resolvable tenant (logged out, mid-account-selection) → platform brand.
  // Tenant resolution is fail-closed now, so never touch tenant settings here
  // without checking first.
  if (!resolveCurrentTenant()) {
    return {
      title: "AdonisAgent",
      description: "AdonisAgent — management & marketing.",
    };
  }
  const profile = getBusinessProfile();
  return {
    title: profile.businessName,
    description: `${profile.businessName} — management & marketing.`,
  };
}

export const dynamic = "force-dynamic";

const FONT_VARS = `${body.variable} ${mono.variable} ${heading.variable} ${familjen.variable} ${nebula.variable} ${nebulaHollow.variable} ${clashDisplay.variable} ${inter.variable} ${manrope.variable} ${spaceGrotesk.variable} ${playfairDisplay.variable} ${bebasNeue.variable}`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Render WITHOUT the admin shell for: public CMS-served sites (/site/*), public
  // form share links (/f/<slug> — Batch 4c), and the full-screen visual editor
  // (/cms/<slug>/studio). The studio still enforces admin auth in its own page;
  // the public routes are allow-listed in middleware. Without this, an anonymous
  // visitor hitting a share link would be wrapped in the logged-out admin
  // sidebar chrome (and getCurrentTenant() below would resolve the unrelated
  // DEFAULT tenant) instead of seeing a standalone branded form.
  const pathname = headers().get("x-pathname") ?? "";
  const isStudio = /^\/cms\/[^/]+\/studio(\/|$)/.test(pathname);
  if (pathname.startsWith("/site/") || pathname.startsWith("/f/") || isStudio) {
    return (
      <html lang="en" className={FONT_VARS}>
        <body>{children}</body>
      </html>
    );
  }

  // Client mobile app (`/app`) — its own branded, phone-width shell (no coach
  // chrome). Theme + logo resolve to the signed-in client's tenant.
  if (pathname === "/app" || pathname.startsWith("/app/")) {
    // Tenant branding only resolves once a member is signed in (their session
    // pins the tenant). Logged out (/app/login, /app/reset) there is NO tenant
    // to brand for — render neutral chrome rather than any tenant's.
    const clientTenant = resolveCurrentTenant();
    const clientThemeStyle = themeCss(clientTenant ? getTheme() : DEFAULT_THEME);
    const clientLogo = clientTenant ? getChromeLogoSrc() : null;
    const clientBusiness = clientTenant ? getBusinessProfile().businessName : "";

    // Client-app billing gate (spec §6). A member's access follows their gym's
    // billing status, resolved from the CLIENT session's own tenant (never the
    // staff-first `db` proxy). When the gym is suspended / cancelled / not yet
    // activated, members see a friendly "paused" screen instead of the app.
    // /app/login stays reachable so login never loops; past_due keeps access
    // (only the owner is nudged, via the staff-side banner).
    if (pathname !== "/app/login") {
      const clientSession = getClientSession();
      if (clientSession) {
        const cBilling = getBilling(clientSession.tenantId);
        if (
          cBilling &&
          !cBilling.billingExempt &&
          (cBilling.status === "suspended" ||
            cBilling.status === "cancelled" ||
            cBilling.status === "pending_payment")
        ) {
          return (
            <html lang="en" className={FONT_VARS}>
              <body>
                <style id="tenant-theme" dangerouslySetInnerHTML={{ __html: clientThemeStyle }} />
                <div
                  style={{
                    minHeight: "100dvh",
                    display: "grid",
                    placeItems: "center",
                    padding: "24px",
                    textAlign: "center",
                    fontFamily: "var(--font-body), system-ui, sans-serif",
                  }}
                >
                  <div style={{ maxWidth: 340 }}>
                    <div style={{ fontSize: 40, marginBottom: 14 }} aria-hidden>
                      ⏳
                    </div>
                    <h1 style={{ fontSize: 20, margin: "0 0 8px", fontFamily: "var(--font-heading), sans-serif" }}>
                      {clientBusiness} is temporarily unavailable
                    </h1>
                    <p style={{ color: "var(--text-secondary)", fontSize: 14.5, lineHeight: 1.55, margin: 0 }}>
                      The app is paused right now. Please check back soon, or contact {clientBusiness} directly if you
                      need anything in the meantime.
                    </p>
                  </div>
                </div>
              </body>
            </html>
          );
        }
      }
    }
    return (
      <html lang="en" className={FONT_VARS}>
        <body>
          <style id="tenant-theme" dangerouslySetInnerHTML={{ __html: clientThemeStyle }} />
          <MotionRoot>
            <ConfirmProvider>
              <ClientAppFrame logoSrc={clientLogo} businessName={clientBusiness}>
                {children}
              </ClientAppFrame>
            </ConfirmProvider>
          </MotionRoot>
          <Toaster richColors position="top-center" toastOptions={{ style: { fontFamily: "var(--font-body), sans-serif", border: "1px solid var(--hairline)" } }} />
        </body>
      </html>
    );
  }

  const user = await getSessionUser();

  // Central guard: an authenticated identity with no resolved clinic (a
  // multi-clinic user who hasn't chosen) is sent to /select-account on any
  // non-bare page, so individual pages don't each need the check. Single-clinic
  // users auto-resolve in getCurrentMembership and never trip this.
  let accounts: SidebarAccount[] = [];
  let activeTenantId: number | null = null;
  let showPastDue = false;
  const current = user ? getCurrentMembership() : null;
  if (user) {
    const bare = ["/login", "/change-password", "/select-account", "/accept-invite"].some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
    if (!bare && !current) {
      redirect("/select-account");
    }
    if (current) {
      activeTenantId = current.tenant.id;
      const memberships = await listActiveMemberships(user.id);
      accounts = memberships.map((m) => ({
        tenantId: m.tenantId,
        name: m.name,
        role: m.role,
      }));

      // Billing gate (spec §6): only when a tenant_billing row exists and isn't
      // exempt. The billing/dev-pay screens + API + the bare auth pages must stay
      // reachable, else a pending/suspended tenant can never pay (and the
      // must-change-password guard would ping-pong with this redirect).
      const billing = getBilling(current.tenant.id);
      if (billing && !billing.billingExempt) {
        const onExempt =
          bare ||
          pathname.startsWith("/billing") ||
          pathname.startsWith("/dev/pay") ||
          pathname.startsWith("/api/");
        if (!onExempt && billing.status === "pending_payment") redirect("/billing/activate");
        if (!onExempt && billing.status === "suspended") redirect("/billing/suspended");
        showPastDue = billing.status === "past_due";
      }
    }
  }

  // Tenant chrome (theme, logo, vocabulary) resolves only with an active
  // membership. Bare pages (login, select-account, change-password,
  // accept-invite) render platform-neutral chrome — tenant resolution is
  // fail-closed, so touching tenant settings here without a membership throws.
  const vocab = getVocab(current ? getVenueType() : "clinic");
  const logoSrc = current ? getChromeLogoSrc() : null;
  const businessName = current ? getBusinessProfile().businessName : "";
  const themeStyle = themeCss(current ? getTheme() : DEFAULT_THEME);
  const tenantSlug = current ? current.tenant.slug : "";
  const schedulingMode = current ? getSchedulingMode() : "appointments";
  return (
    <html lang="en" className={FONT_VARS}>
      <body>
        {/* Per-tenant theme overrides — injected after globals.css so the
            derived palette (background + accent) wins. */}
        <style id="tenant-theme" dangerouslySetInnerHTML={{ __html: themeStyle }} />
        <div className="grain" aria-hidden />
        <MotionRoot>
          <TooltipProvider delayDuration={300}>
            <ConfirmProvider>
              <AppShell
                vocab={vocab}
                logoSrc={logoSrc}
                businessName={businessName}
                accounts={accounts}
                activeTenantId={activeTenantId}
                tenantSlug={tenantSlug}
                schedulingMode={schedulingMode}
                user={
                  user
                    ? {
                        id: user.id,
                        email: user.email,
                        name: user.name,
                        role: user.role,
                      }
                    : null
                }
              >
                {showPastDue ? <PastDueBanner /> : null}
                {children}
              </AppShell>
            </ConfirmProvider>
          </TooltipProvider>
        </MotionRoot>
        <Toaster
          richColors
          position="top-right"
          toastOptions={{
            style: {
              fontFamily: "var(--font-body), sans-serif",
              border: "1px solid var(--hairline)",
            },
          }}
        />
      </body>
    </html>
  );
}
