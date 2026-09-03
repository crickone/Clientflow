import { listRecentWork, countByKind } from "@/lib/content-studio/recentWork";
import { listLibraryAssets } from "@/lib/image/library";
import { getBrandFontIds } from "@/lib/settings";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getChromeLogoSrc } from "@/lib/branding";
import { ContentStudioHome } from "@/components/content-studio/ContentStudioHome";

export const dynamic = "force-dynamic";

export default function ContentStudioIndex() {
  const items = listRecentWork();
  const counts = countByKind(items);
  const library = listLibraryAssets();
  const brandFonts = getBrandFontIds();
  const bp = getBusinessProfile();
  return (
    <ContentStudioHome
      items={items}
      counts={counts}
      library={library}
      brand={{
        businessName: bp.businessName,
        website: bp.website,
        location: bp.location,
        phone: bp.phone,
      }}
      defaultHeadingFontId={brandFonts.heading}
      defaultBodyFontId={brandFonts.body}
      logoUrl={getChromeLogoSrc()}
    />
  );
}
