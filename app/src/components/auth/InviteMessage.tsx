import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";

/** Static full-screen notice for the invalid/expired/accepted invite states. */
export function InviteMessage({
  logoSrc,
  businessName,
  title,
  body,
  showSignIn,
}: {
  logoSrc: string | null;
  businessName: string;
  title: string;
  body: string;
  showSignIn?: boolean;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "var(--surface-1)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          padding: "36px 32px",
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <Logo src={logoSrc} alt={businessName} height={28} />
        </div>
        <h1
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: 22,
            fontWeight: 400,
            color: "var(--text-primary)",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          {title}
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.55 }}>
          {body}
        </p>
        {showSignIn && (
          <Link href="/login" style={{ display: "block", marginTop: 22 }}>
            <Button style={{ width: "100%" }}>Go to sign in</Button>
          </Link>
        )}
      </div>
    </div>
  );
}
