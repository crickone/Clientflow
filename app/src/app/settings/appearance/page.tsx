import { redirect } from "next/navigation";

// Per-account appearance settings were removed (2026-10-07): every account
// shares one look, with only the per-browser light/dark toggle. Old links land
// on Settings.
export default function AppearanceSettingsPage() {
  redirect("/settings");
}
