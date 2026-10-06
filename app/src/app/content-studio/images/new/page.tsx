import { StartDesign } from "@/components/content-studio/StartDesign";
import { listLibraryAssets } from "@/lib/image/library";
import { getBrandFontIds, getTheme } from "@/lib/settings";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getChromeLogoSrc } from "@/lib/branding";

export const dynamic = "force-dynamic";

/**
 * Step 1 of the image flow: one composer. Say what the post is about (or pick
 * an idea, or a template below), choose carousel or single, and see the shape
 * of it in the preview beside the box before Adonis writes it. The route is
 * unchanged, so every existing link still lands here.
 */
export default function NewImagePage() {
  const library = listLibraryAssets();
  const brandFonts = getBrandFontIds();
  const bp = getBusinessProfile();
  return (
    <>
      <header className="nc-head">
        <h1 className="nc-title">New post</h1>
      </header>
      <StartDesign
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
      />
    </>
  );
}
