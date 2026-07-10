import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { getCarousel } from "@/lib/image/carousels";
import { listLibraryAssets } from "@/lib/image/library";
import { getBrandFontIds } from "@/lib/settings";
import { getBusinessProfile } from "@/lib/businessProfile";
import { ImageDesigner } from "@/components/content-studio/ImageDesigner";

export const dynamic = "force-dynamic";

export default function ImageDesignPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  const design = getCarousel(id);
  if (!design) notFound();
  const library = listLibraryAssets();
  const brandFonts = getBrandFontIds();
  const bp = getBusinessProfile();
  const brand = {
    businessName: bp.businessName,
    website: bp.website,
    location: bp.location,
    phone: bp.phone,
  };

  const slideCount = design.slides.length;
  const subtitle =
    slideCount > 1
      ? `${slideCount} slides`
      : design.slides[0]
        ? `${design.slides[0].aspectRatio} · single image`
        : "No slides";

  return (
    <>
      <PageHeader
        eyebrow={`Design #${design.id}`}
        title={design.name}
        subtitle={subtitle}
        actions={
          <Link href="/content-studio/images">
            <Button variant="outline">
              <ArrowLeft size={15} />
              All designs
            </Button>
          </Link>
        }
      />
      <ImageDesigner
        designId={design.id}
        initialName={design.name}
        initialSlides={design.slides}
        initialLibrary={library}
        defaultHeadingFontId={brandFonts.heading}
        defaultBodyFontId={brandFonts.body}
        brand={brand}
      />
    </>
  );
}
