import { PageHeader } from "@/components/layout/PageHeader";
import { listLibraryAssets } from "@/lib/image/library";
import { LibraryManager } from "@/components/content-studio/LibraryManager";

export const dynamic = "force-dynamic";

export default function LibraryPage() {
  const assets = listLibraryAssets();
  return (
    <>
      <PageHeader
        eyebrow="Media"
        title="Library"
        subtitle="Upload your images and videos once, then reuse them across your content. Images are available in the Images designer; videos are stored here for your projects."
      />
      <LibraryManager initialAssets={assets} />
    </>
  );
}
