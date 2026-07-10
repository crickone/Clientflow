import { redirect } from "next/navigation";
import { addSlide, createCarousel } from "@/lib/image/carousels";

export const dynamic = "force-dynamic";

/**
 * Land on /new → spin up an empty design with one default slide and drop the
 * user straight into the editor. Keeps the original "open the editor, pick a
 * template, start designing" flow rather than gating it behind a setup form.
 */
export default function NewImagePage() {
  const design = createCarousel({ name: "Untitled design" });
  addSlide({
    carouselSetId: design.id,
    templateId: "bold-headline",
    aspectRatio: "1:1",
  });
  redirect(`/content-studio/images/${design.id}`);
}
