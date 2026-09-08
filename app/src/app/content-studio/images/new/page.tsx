import { PageHeader } from "@/components/layout/PageHeader";
import { StartTabs } from "@/components/content-studio/StartTabs";
import { listLibraryAssets } from "@/lib/image/library";
import { getBrandFontIds, getTheme } from "@/lib/settings";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getChromeLogoSrc } from "@/lib/branding";
import { getDesignSystem } from "@/lib/design/system";

export const dynamic = "force-dynamic";

/**
 * Step 1 of the image flow. This page used to create a design silently and
 * redirect straight into the editor, where the first thing you were shown was a
 * 32-template grid — asking for a styling decision before you'd said what the
 * post was about. Then it asked that first instead.
 *
 * It now offers both, as tabs: AI generation (say what it's about) and
 * Templates (pick a look, write it yourself). The route is unchanged, so every
 * existing link and deep link still lands here.
 */
export default function NewImagePage() {
  const library = listLibraryAssets();
  const brandFonts = getBrandFontIds();
  const bp = getBusinessProfile();
  return (
    <>
      <PageHeader
        eyebrow="New design"
        title="Start a post"
        subtitle="Say what it's about, or pick a template and write it yourself."
      />
      <StartTabs
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
        accentColor={getTheme().accent}
        hasDesignSystem={getDesignSystem() !== null}
      />
    </>
  );
}
