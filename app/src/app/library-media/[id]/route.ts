import { getLibraryAsset } from "@/lib/cms/library";
import { getObject } from "@/lib/cms/storage";

export const dynamic = "force-dynamic";

/**
 * Public delivery for shared CMS library assets. Unauthenticated — these images
 * are embedded in public site pages and must load for everyone. Global by id
 * (not site-scoped), so an image is usable on any site. Cacheable so a CDN can
 * sit in front in production.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return new Response("Not found", { status: 404 });

  const asset = getLibraryAsset(id);
  if (!asset) return new Response("Not found", { status: 404 });

  const bytes = await getObject(asset.storageKey);
  if (!bytes) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": asset.mimeType || "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
      "Content-Length": String(bytes.length),
    },
  });
}
