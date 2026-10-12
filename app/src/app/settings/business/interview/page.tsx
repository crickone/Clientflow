import { requireAdminPage } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getBrandImageStyle, getVenueType } from "@/lib/settings";
import { listTherapies } from "@/lib/queries";
import { interviewQuestions } from "@/lib/brandInterview/questions";
import { BrandInterview } from "@/components/settings/BrandInterview";
import { readInterview } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The brand interview: one question at a time about the business, then
 * Adonis writes the brief, tone notes, marketing brain and image style for
 * the owner to review and keep. Answers save as you go.
 */
export default async function BrandInterviewPage() {
  await requireAdminPage();
  const profile = getBusinessProfile();
  const venue = getVenueType();
  const parts = profile.location.split(",").map((s) => s.trim()).filter(Boolean);
  const town = parts.find((x) => /^[A-Z][a-z]+$/.test(x) && !/^Co\b/.test(x)) ?? "";
  const services = (await listTherapies()).map((t) => t.name);
  const questions = interviewQuestions(venue, { name: profile.businessName, town, services });
  const answers = await readInterview();
  // The one-liner starts from the tagline the account already has.
  if (!answers.oneLiner?.text && profile.tagline) answers.oneLiner = { text: profile.tagline };
  return (
    <BrandInterview
      businessName={profile.businessName}
      questions={questions}
      initialAnswers={answers}
      current={{
        tagline: profile.tagline,
        brief: profile.brief,
        voiceNotes: profile.voiceNotes,
        marketingBrain: profile.marketingBrain,
        imageStyle: getBrandImageStyle() ?? "",
      }}
    />
  );
}
