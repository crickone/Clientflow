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
        subtitle="Upload once, use anywhere. Images appear in the Images designer and are what Adonis offers when you ask it to change a picture on the website. Videos and documents are kept here for your projects."
      />
      <LibraryManager initialAssets={assets} />
    </>
  );
}
