import { WIDGET_IMPLS } from "@/lib/dashboard/widgets";
import type { WidgetKey } from "@/lib/dashboard/catalog";
import type { WidgetCtx, WidgetImpl } from "@/lib/dashboard/types";

/**
 * Loads and renders one widget. Runs inside its own <Suspense> and
 * <WidgetErrorBoundary> (see the dashboard page), so a slow widget streams
 * in late and a failing one only breaks its own tile.
 */
export async function WidgetSlot({ widgetKey, ctx, tenantId }: { widgetKey: string; ctx: WidgetCtx; tenantId: number }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const impl = (WIDGET_IMPLS as Record<WidgetKey, WidgetImpl<any>>)[widgetKey as WidgetKey];
  if (!impl) return null;
  try {
    const data = await impl.load(ctx);
    return <>{impl.render(data, ctx)}</>;
  } catch (err) {
    console.error(`[dashboard] widget ${widgetKey} failed for tenant ${tenantId}`, err);
    throw err;
  }
}
