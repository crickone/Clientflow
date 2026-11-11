import "server-only";
import { revalidateTag } from "next/cache";

/**
 * Every console write calls this. The fleet lists (dashboard, businesses,
 * health) are cached for 30 seconds under "fleet"; a business's own detail
 * under "tenant-<id>" for 15. A write to either must not be invisible for
 * half a minute, so the tag goes first and the next read is fresh.
 */
export function bust(tenantId?: number): void {
  revalidateTag("fleet");
  if (tenantId !== undefined) revalidateTag(`tenant-${tenantId}`);
}
