import Link from "next/link";
import { Image as ImageIcon, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { listCarousels } from "@/lib/image/carousels";
import { CarouselList } from "@/components/content-studio/CarouselList";

export const dynamic = "force-dynamic";

export default function ImagesPage() {
  const designs = listCarousels();
  return (
    <>
      <PageHeader
        eyebrow="AI Image"
        title="Images"
        subtitle="Pick a template, drop in a photo, edit the copy. Add more slides any time to turn a single design into a carousel."
        actions={
          <Link href="/content-studio/images/new">
            <Button>
              <Plus size={15} />
              New design
            </Button>
          </Link>
        }
      />
      {designs.length === 0 ? (
        <EmptyState
          icon={<ImageIcon size={32} strokeWidth={1.4} />}
          title="No designs yet"
          message="Start a design — pick a template, drop in a photo, write a heading."
          action={
            <Link href="/content-studio/images/new">
              <Button>
                <Plus size={15} />
                New design
              </Button>
            </Link>
          }
        />
      ) : (
        <CarouselList carousels={designs} />
      )}
    </>
  );
}
