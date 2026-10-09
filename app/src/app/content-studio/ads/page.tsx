import { AdLibrary } from "@/components/content-studio/ads/AdLibrary";
import { listAdCreatives } from "@/lib/ads/creatives";
import { getCurrentMembership } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * The ad library: the ads worth coming back to, and every ad made. Saving is
 * a bookmark on the ad itself, so an ad is never copied and the version that
 * runs is always the one that was edited last.
 */
export default function AdLibraryPage() {
  return <AdLibrary ads={listAdCreatives()} isAdmin={getCurrentMembership()?.role === "admin"} />;
}
