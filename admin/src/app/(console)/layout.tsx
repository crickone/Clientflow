import type { ReactNode } from "react";

import { api } from "@/lib/api";
import { requireAdminSession } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import type { ConsoleView } from "@/lib/views";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const user = await requireAdminSession();
  let views: ConsoleView[] = [];
  try {
    views = (await api<{ views: ConsoleView[] }>("/views")).views;
  } catch {
    views = [];
  }
  let inboxCount = { bad: 0, warn: 0 };
  try {
    inboxCount = (await api<{ counts: { bad: number; warn: number } }>("/alerts", { revalidate: 60, tags: ["fleet"] })).counts;
  } catch {
    inboxCount = { bad: 0, warn: 0 };
  }
  return (
    <ConfirmProvider>
      <Shell user={user} views={views} inboxCount={inboxCount}>{children}</Shell>
    </ConfirmProvider>
  );
}
