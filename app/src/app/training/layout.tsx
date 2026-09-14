import { notFound } from "next/navigation";

import { resolveCurrentTenant } from "@/lib/db/tenant";

// The Training module is staff-training content written specifically for the
// Clonmel clinic (Optimal Health at Inspire, formerly Renova) — it's not
// available to other tenants. Gate the whole /training route subtree here so
// it 404s for any other account (the nav item is hidden separately in the
// sidebar). Unresolved tenant (no session) → 404 too, never a default.
export default function TrainingLayout({ children }: { children: React.ReactNode }) {
  if (resolveCurrentTenant()?.slug !== "optimal-health") notFound();
  return <>{children}</>;
}
