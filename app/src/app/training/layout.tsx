import { notFound } from "next/navigation";

import { resolveCurrentTenant } from "@/lib/db/tenant";

// The Training module is staff-training content for the HBOT/PEMF/infrared
// clinics (Optimal Health at Inspire today; Renova Cellular Health when it
// opens) — it's not available to other tenants. Gate the whole /training
// route subtree here so it 404s for any other account (the nav item is hidden
// separately in the sidebar). Unresolved tenant (no session) → 404 too,
// never a default.
const TRAINING_TENANTS = new Set(["optimal-health", "renova"]);

export default function TrainingLayout({ children }: { children: React.ReactNode }) {
  const slug = resolveCurrentTenant()?.slug;
  if (!slug || !TRAINING_TENANTS.has(slug)) notFound();
  return <>{children}</>;
}
