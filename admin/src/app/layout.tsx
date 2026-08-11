import type { ReactNode } from "react";
import "./globals.css";
import { body, heading, mono, nebula } from "./fonts";

export const metadata = { title: "AdonisAgent Platform" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${body.variable} ${heading.variable} ${mono.variable} ${nebula.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
