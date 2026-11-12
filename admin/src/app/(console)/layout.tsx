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
  return (
    <ConfirmProvider>
      <Shell user={user} views={views}>{children}</Shell>
    </ConfirmProvider>
  );
}
