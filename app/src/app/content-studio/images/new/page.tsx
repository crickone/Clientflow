import { PageHeader } from "@/components/layout/PageHeader";
import { StartDesign } from "@/components/content-studio/StartDesign";

export const dynamic = "force-dynamic";

/**
 * Step 1 of the image flow. This page used to create a design silently and
 * redirect straight into the editor, where the first thing you were shown was a
 * 32-template grid — asking for a styling decision before you'd said what the
 * post was about. Now it asks that first, and generating the copy IS the step
 * rather than a button hidden in the editor's toolbar.
 */
export default function NewImagePage() {
  return (
    <>
      <PageHeader
        eyebrow="New design"
        title="Start a post"
        subtitle="Say what it's about and whether it's a carousel or a single image. You'll pick the look next."
      />
      <StartDesign />
    </>
  );
}
