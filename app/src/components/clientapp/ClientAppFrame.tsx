"use client";

import { usePathname, useRouter } from "next/navigation";
import { CalendarRange, ChevronLeft, Dumbbell, LayoutDashboard, Salad, User } from "lucide-react";

import { Logo } from "@/components/ui/Logo";

const TABS = [
  { href: "/app", label: "Home", icon: LayoutDashboard, exact: true },
  { href: "/app/timetable", label: "Classes", icon: CalendarRange },
  { href: "/app/nutrition", label: "Nutrition", icon: Salad },
  { href: "/app/workouts", label: "Workouts", icon: Dumbbell },
  { href: "/app/profile", label: "Profile", icon: User },
];
const TAB_HREFS = new Set(TABS.map((t) => t.href));

export function ClientAppFrame({
  logoSrc,
  businessName,
  children,
}: {
  logoSrc: string | null;
  businessName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/app/login";
  // Sub-page = any /app route that isn't one of the bottom-nav tabs → show a back button.
  const isSubPage = !isLogin && !TAB_HREFS.has(pathname);

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push("/app");
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", justifyContent: "center" }}>
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          minHeight: "100vh",
          background: "var(--bg)",
          borderLeft: "1px solid var(--hairline)",
          borderRight: "1px solid var(--hairline)",
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {!isLogin && (
          <header
            style={{
              position: "sticky",
              top: 0,
              zIndex: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 52,
              padding: "10px 14px",
              background: "var(--glass)",
              backdropFilter: "blur(10px)",
              borderBottom: "1px solid var(--hairline)",
            }}
          >
            {isSubPage && (
              <button
                onClick={goBack}
                aria-label="Back"
                style={{
                  position: "absolute",
                  left: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 36,
                  height: 36,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "var(--radius)",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                <ChevronLeft size={22} />
              </button>
            )}
            <Logo src={logoSrc} alt={businessName} height={22} />
          </header>
        )}

        <main style={{ flex: 1, padding: isLogin ? 0 : "16px 16px 88px" }}>{children}</main>

        {!isLogin && (
          <nav
            style={{
              position: "sticky",
              bottom: 0,
              display: "grid",
              gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
              background: "var(--glass)",
              backdropFilter: "blur(10px)",
              borderTop: "1px solid var(--hairline)",
            }}
          >
            {TABS.map((t) => {
              const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
              const Icon = t.icon;
              return (
                <button
                  key={t.href}
                  onClick={() => router.push(t.href)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 3,
                    padding: "9px 0 11px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: active ? "var(--accent-ink)" : "var(--text-tertiary)",
                  }}
                >
                  <Icon size={21} strokeWidth={active ? 2.2 : 1.8} />
                  <span style={{ fontSize: 10.5, fontWeight: active ? 600 : 400 }}>{t.label}</span>
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
