"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";

/**
 * The one way back to Settings, above every settings sub-page. Pages used to
 * carry their own: some a "Back to settings" text link above the title,
 * others an "All settings" button beside it, so the control moved between
 * screens. Rendered by PageHeader on every page under /settings/ (and on
 * nothing else), so it sits in the same spot as the title on every one.
 */
export function SettingsBack() {
  const pathname = usePathname() ?? "";
  if (!pathname.startsWith("/settings/")) return null;
  return (
    <Link href="/settings" className="settings-back">
      <ChevronLeft size={15} strokeWidth={2} />
      Settings
    </Link>
  );
}
