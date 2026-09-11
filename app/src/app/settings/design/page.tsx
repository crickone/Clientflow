import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage } from "@/lib/auth";
import { DESIGN_DIRECTIONS } from "@/lib/design/directions";
import { AVAILABLE_FAMILIES } from "@/lib/design/fonts";
import { designStatus } from "@/lib/design/directionStore";
import { getTheme } from "@/lib/settings";
import { DesignDirectionView } from "@/components/settings/DesignDirectionView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Design direction — AdonisAgent" };

export default async function DesignDirectionPage() {
  await requireAdminPage();
  return (
    <div className="app-page" style={{ maxWidth: 900 }}>
      <PageHeader
        eyebrow="Settings"
        title="Design direction"
        subtitle="The look Adonis composes your posts in: a typeface, a scale, a grid and a rotation of grounds, in your own colours."
        actions={
          <Link href="/settings">
            <Button variant="outline">
              <ArrowLeft size={15} />
              All settings
            </Button>
          </Link>
        }
      />
      <DesignDirectionView
        directions={DESIGN_DIRECTIONS.map((d) => ({
          id: d.id,
          name: d.name,
          blurb: d.blurb,
          font: d.font,
          slots: d.slots.map((s) => ({
            key: s.key,
            label: s.label,
            role: s.role,
            defaultHex: s.defaultHex.toLowerCase(),
          })),
          type: d.type,
          photo: d.photo ? { saturate: d.photo.saturate, contrast: d.photo.contrast, brightness: d.photo.brightness } : null,
        }))}
        fonts={[...AVAILABLE_FAMILIES]}
        status={designStatus()}
        brandAccent={getTheme().accent.toLowerCase()}
      />
    </div>
  );
}
