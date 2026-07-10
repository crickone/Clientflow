import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { ClientAppFrame } from "@/components/clientapp/ClientAppFrame";
import {
  getCurrentMembership,
  getSessionUser,
  listActiveMemberships,
} from "@/lib/auth";
import type { SidebarAccount } from "@/components/layout/Sidebar";
import { getTheme, getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";
import { themeCss } from "@/lib/theme";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getChromeLogoSrc } from "@/lib/branding";
import {
  bebasNeue,
  body,
  clashDisplay,
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
  const profile = getBusinessProfile();
  return {
    title: profile.businessName,
    description: `${profile.businessName} — management & marketing.`,
  };
}

export const dynamic = "force-dynamic";

const FONT_VARS = `${body.variable} ${mono.variable} ${heading.variable} ${nebula.variable} ${nebulaHollow.variable} ${clashDisplay.variable} ${inter.variable} ${manrope.variable} ${spaceGrotesk.variable} ${playfairDisplay.variable} ${bebasNeue.variable}`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Render WITHOUT the admin shell for: public CMS-served sites (/site/*) and the
  // full-screen visual editor (/cms/<slug>/studio). The studio still enforces
  // admin auth in its own page; the public routes are allow-listed in middleware.
  const pathname = headers().get("x-pathname") ?? "";
  const isStudio = /^\/cms\/[^/]+\/studio(\/|$)/.test(pathname);
  if (pathname.startsWith("/site/") || isStudio) {
    return (
      <html lang="en" className={FONT_VARS}>
        <body>{children}</body>
      </html>
    );
  }

  // Client mobile app (`/app`) — its own branded, phone-width shell (no coach
  // chrome). Theme + logo resolve to the signed-in client's tenant.
  if (pathname === "/app" || pathname.startsWith("/app/")) {
    const clientThemeStyle = themeCss(getTheme());
    const clientLogo = getChromeLogoSrc();
    const clientBusiness = getBusinessProfile().businessName;
    return (
      <html lang="en" className={FONT_VARS}>
        <body>
          <style id="tenant-theme" dangerouslySetInnerHTML={{ __html: clientThemeStyle }} />
          <ClientAppFrame logoSrc={clientLogo} businessName={clientBusiness}>
            {children}
          </ClientAppFrame>
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
  if (user) {
    const bare = ["/login", "/change-password", "/select-account"].some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
    const current = getCurrentMembership();
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
    }
  }

  const vocab = getVocab(getVenueType());
  const logoSrc = getChromeLogoSrc();
  const businessName = getBusinessProfile().businessName;
  const themeStyle = themeCss(getTheme());
  return (
    <html lang="en" className={FONT_VARS}>
      <body>
        {/* Per-tenant theme overrides — injected after globals.css so the
            derived palette (background + accent) wins. */}
        <style id="tenant-theme" dangerouslySetInnerHTML={{ __html: themeStyle }} />
        <div className="grain" aria-hidden />
        <AppShell
          vocab={vocab}
          logoSrc={logoSrc}
          businessName={businessName}
          accounts={accounts}
          activeTenantId={activeTenantId}
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
          {children}
        </AppShell>
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
