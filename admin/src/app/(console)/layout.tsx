import type { ReactNode } from "react";

import { requireAdminSession } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const user = await requireAdminSession();
  return (
    <ConfirmProvider>
      <Shell user={user}>{children}</Shell>
    </ConfirmProvider>
  );
}
