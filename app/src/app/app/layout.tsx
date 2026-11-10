import type { Metadata } from "next";

/**
 * The member app wears its business's icon in the browser tab too, the same
 * one as on the home screen (app/pwa/icon), not the platform's.
 */
export const metadata: Metadata = {
  icons: { icon: { url: "/app/pwa/icon?s=192", type: "image/png", sizes: "192x192" } },
};

export default function MemberAppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
