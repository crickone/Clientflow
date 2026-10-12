import { redirect } from "next/navigation";

// /billing/activate and /billing/suspended are flow pages; the account's
// billing lives in Settings.
export default function BillingIndex() {
  redirect("/settings/billing");
}
