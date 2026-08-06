import { ExternalLink, Smartphone } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function MyAppPage() {
  await requireUser();
  return (
    <div className="app-page" style={{ maxWidth: 960 }}>
      <PageHeader
        eyebrow="My App"
        title="Your client app"
        subtitle="A branded mobile app where your clients see their dashboard, book classes, and track attendance, nutrition & workouts. It uses your theme and logo, and updates live from this dashboard."
      />

      <div className="myapp-grid">
        {/* Open app + phone preview */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <Card style={{ padding: 22, width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <Smartphone size={20} style={{ color: "var(--accent-ink)" }} />
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>Open the client app</div>
            </div>
            <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.6, margin: "0 0 14px" }}>
              The app lives at <code style={{ fontFamily: "var(--font-mono), monospace", color: "var(--accent-ink)" }}>/app</code>. Clients sign in with their own login and only ever see their own data.
            </p>
            <a href="/app/login" target="_blank" rel="noreferrer">
              <Button variant="outline">
                <ExternalLink size={15} /> Open client app
              </Button>
            </a>
          </Card>
          <div
            style={{
              width: "min(320px, 86vw)",
              aspectRatio: "320 / 660",
              boxSizing: "border-box",
              borderRadius: 40,
              border: "10px solid #0b0b0d",
              boxShadow: "0 24px 60px -24px rgba(0,0,0,0.6)",
              overflow: "hidden",
              background: "var(--bg)",
            }}
          >
            <iframe src="/app/login" title="Client app preview" style={{ width: "100%", height: "100%", border: "none" }} />
          </div>
        </div>

        {/* info */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card style={{ padding: 22 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 }}>What clients can do</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.9 }}>
              <li>See an at-a-glance <strong>dashboard</strong> — this week&apos;s progress, next class, membership.</li>
              <li>Browse the <strong>timetable</strong> and <strong>book / cancel</strong> classes.</li>
              <li>Track their own <strong>attendance</strong> history.</li>
              <li>View their <strong>membership</strong> details.</li>
              <li>See their <strong>nutrition plans</strong> and <strong>workout programs</strong>.</li>
            </ul>
          </Card>

          <Card style={{ padding: 22 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>Branding &amp; sync</div>
            <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
              The app automatically uses the theme and logo from <strong>Settings → Appearance</strong>, and reads the same live data as this dashboard — so any change you make here is reflected instantly in the app.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
