import { CollectingNote } from "@/components/dashboard/views/CollectingNote";
import { CATALOG_BY_KEY } from "@/lib/dashboard/catalog";
import { WIDGET_IMPLS } from "@/lib/dashboard/widgets";
import type { WidgetKey } from "@/lib/dashboard/catalog";
import type { WidgetCtx, WidgetImpl, WidgetMeta } from "@/lib/dashboard/types";

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
    const meta = CATALOG_BY_KEY.get(widgetKey) as WidgetMeta | undefined;
    const started = meta?.recorder ? ctx.recorderStart(meta.recorder) : undefined;
    const collecting = meta?.recorder && (!started || started.getTime() > ctx.range.fromMs);
    return (
      <>
        {collecting && <CollectingNote since={started ?? ctx.now} />}
        {impl.render(data, ctx)}
      </>
    );
  } catch (err) {
    console.error(`[dashboard] widget ${widgetKey} failed for tenant ${tenantId}`, err);
    throw err;
  }
}
