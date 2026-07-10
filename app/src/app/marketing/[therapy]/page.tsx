import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { TherapySwitcher } from "@/components/TherapySwitcher";
import { TherapyView } from "@/components/TherapyView";
import {
  loadIndex,
  loadTherapy,
  THERAPY_IDS,
  type TherapyId,
} from "@/lib/therapies";
import { getChromeLogoSrc } from "@/lib/branding";
import { getBusinessProfile } from "@/lib/businessProfile";

// Dynamic so the chrome logo / business name reflect the current profile.
// Invalid params are guarded by the notFound() check below.
export const dynamic = "force-dynamic";

interface Props {
  params: { therapy: string };
}

const TITLES: Record<TherapyId, string> = {
  hbot: "HBOT Ad Library",
  ir: "Infrared Ad Library",
  pemf: "PEMF Ad Library",
};

export default function TherapyPage({ params }: Props) {
  const id = params.therapy as TherapyId;
  if (!THERAPY_IDS.includes(id)) notFound();

  const data = loadTherapy(id);
  const { therapies } = loadIndex();

  return (
    <>
      <Header
        title={TITLES[id]}
        subtitle={data.subtitle}
        logoSrc={getChromeLogoSrc()}
        businessName={getBusinessProfile().businessName}
      />
      <TherapySwitcher therapies={therapies} active={id} />
      <TherapyView data={data} />
    </>
  );
}
