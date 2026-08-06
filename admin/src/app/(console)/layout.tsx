import type { ReactNode } from "react";

import { requireAdminSession } from "@/lib/session";
import { Shell } from "@/components/Shell";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const user = await requireAdminSession();
  return <Shell user={user}>{children}</Shell>;
}
