import { redirect } from "next/navigation";

// Fills the empty /marketing slot with the Campaign Engine hub (Slice 1).
export default function MarketingIndex() {
  redirect("/marketing/campaigns");
}
