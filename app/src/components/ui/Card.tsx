import * as React from "react";

export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ children, style, ...rest }, ref) => (
  <div
    ref={ref}
    style={{
      background: "var(--surface-1)",
      border: "1px solid var(--grid)",
      borderRadius: "var(--radius)",
      padding: 24,
      boxShadow: "var(--shadow-1)",
      ...style,
    }}
    {...rest}
  >
    {children}
  </div>
));
Card.displayName = "Card";

export function CardLabel({
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={{
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: 10,
        fontWeight: 400,
        color: "var(--text-tertiary)",
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

export function CardValue({
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={{
        fontFamily: "var(--font-heading), sans-serif",
        fontSize: 36,
        fontWeight: 400,
        color: "var(--text-primary)",
        lineHeight: 1,
        textTransform: "uppercase",
        letterSpacing: 0,
      }}
    >
      {children}
    </div>
  );
}
