import { NewAdForm } from "@/components/content-studio/ads/NewAdForm";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getDesignSystem } from "@/lib/design/system";
import { listLibraryAssets } from "@/lib/image/library";
import { getTheme } from "@/lib/settings";
import { getChromeLogoSrc } from "@/lib/branding";

export const dynamic = "force-dynamic";

/**
 * The New ad composer: the same one-screen shape as New post. Say what the ad
 * is for (or pick one of Adonis's concepts), image or video, and see it take
 * shape in the preview beside the box.
 */
export default function NewAdPage() {
  const bp = getBusinessProfile();
  const photo = listLibraryAssets().find((a) => a.kind === "image");
  return (
    <>
      <header className="nc-head">
        <h1 className="nc-title">New ad</h1>
      </header>
      <NewAdForm
        website={bp.website}
        hasDesignSystem={!!getDesignSystem()}
        businessName={bp.businessName}
        logoUrl={getChromeLogoSrc()}
        photoUrl={photo ? `/api/content-studio/image-library/file/${encodeURIComponent(photo.filename)}` : null}
        accentColor={getTheme().accent}
      />
    </>
  );
}
