import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        maxWidth: "var(--max-width)",
        margin: "0 auto",
        padding: "120px 32px",
      }}
    >
      <div
        style={{
          color: "var(--text-tertiary)",
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginBottom: 14,
        }}
      >
        404
      </div>
      <h1
        style={{
          fontSize: 40,
          fontWeight: 600,
          letterSpacing: "-0.025em",
          marginBottom: 12,
        }}
      >
        Not found
      </h1>
      <p
        style={{
          color: "var(--text-secondary)",
          fontSize: 16,
          marginBottom: 24,
        }}
      >
        That page doesn&rsquo;t exist.
      </p>
      <Link
        href="/"
        style={{
          color: "var(--accent)",
          fontSize: 15,
          fontWeight: 500,
        }}
      >
        Go to dashboard &rarr;
      </Link>
    </div>
  );
}
