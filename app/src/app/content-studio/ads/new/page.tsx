import { NewAdForm } from "@/components/content-studio/ads/NewAdForm";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getDesignSystem } from "@/lib/design/system";

export const dynamic = "force-dynamic";

export default function NewAdPage() {
  const bp = getBusinessProfile();
  return (
    <>
      <header className="nc-head">
        <h1 className="nc-title">New ad</h1>
      </header>
      <NewAdForm website={bp.website} hasDesignSystem={!!getDesignSystem()} />
    </>
  );
}
