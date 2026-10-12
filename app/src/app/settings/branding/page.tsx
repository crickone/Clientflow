import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage } from "@/lib/auth";
import { getBrandingLogoFilename, getBrandImageStyle } from "@/lib/settings";
import { resolveLogoPath } from "@/lib/branding";
import { getBusinessProfile } from "@/lib/businessProfile";
import { defaultImageStyle } from "@/lib/ai/image/prompt";
import { BrandingForm } from "@/components/settings/BrandingForm";

export const dynamic = "force-dynamic";

export default async function BrandingSettingsPage() {
  await requireAdminPage();
  const filename = getBrandingLogoFilename();
  const hasLogo = filename !== null && resolveLogoPath() !== null;
  const imageStyle = getBrandImageStyle() ?? "";
  const imageStyleDefault = defaultImageStyle(getBusinessProfile());

  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader
        eyebrow="Settings"
        title="Branding"
        subtitle="Your business logo, and the photographic style Adonis uses for AI-generated post images."
      />
      <BrandingForm
        hasLogo={hasLogo}
        filename={filename ?? null}
        imageStyle={imageStyle}
        imageStyleDefault={imageStyleDefault}
      />
    </div>
  );
}
