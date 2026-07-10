import { Logo } from "@/components/ui/Logo";

interface Props {
  title: string;
  subtitle: string;
  logoSrc: string | null;
  businessName: string;
}

export function Header({ title, subtitle, logoSrc, businessName }: Props) {
  return (
    <header
      style={{
        position: "relative",
        borderBottom: "1px solid var(--hairline)",
        overflow: "hidden",
      }}
    >
      {/* Atmospheric gradient mesh */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            radial-gradient(ellipse 1000px 500px at 18% 110%,
              rgba(44,108,224,0.10), transparent 60%),
            radial-gradient(ellipse 700px 400px at 100% 0%,
              rgba(138,63,209,0.06), transparent 65%),
            radial-gradient(ellipse 600px 350px at 50% 100%,
              rgba(210,105,30,0.04), transparent 70%)
          `,
          maskImage:
            "linear-gradient(to bottom, rgba(0,0,0,0.95), rgba(0,0,0,0.25) 80%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to bottom, rgba(0,0,0,0.95), rgba(0,0,0,0.25) 80%, transparent)",
        }}
      />
      <div
        style={{
          position: "relative",
          maxWidth: "var(--max-width)",
          margin: "0 auto",
          padding: "84px 32px 56px",
        }}
      >
        <div style={{ marginBottom: 36 }}>
          <Logo src={logoSrc} alt={businessName} height={28} />
        </div>
        <h1
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: "clamp(44px, 6vw, 72px)",
            fontWeight: 400,
            letterSpacing: "-0.01em",
            color: "var(--text-primary)",
            lineHeight: 1,
            marginBottom: 18,
            maxWidth: 900,
            textTransform: "uppercase",
          }}
        >
          {title}
        </h1>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 17,
            fontWeight: 400,
            letterSpacing: "-0.012em",
            maxWidth: 640,
          }}
        >
          {subtitle}
        </p>
      </div>
    </header>
  );
}
