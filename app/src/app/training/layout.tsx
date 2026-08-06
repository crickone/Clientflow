import { notFound } from "next/navigation";

import { getCurrentTenant } from "@/lib/db/tenant";

// The Training module was built specifically for Renova — it's not available to
// other tenants. Gate the whole /training route subtree here so it 404s for any
// other account (the nav item is hidden separately in the sidebar).
export default function TrainingLayout({ children }: { children: React.ReactNode }) {
  if (getCurrentTenant().slug !== "renova") notFound();
  return <>{children}</>;
}
