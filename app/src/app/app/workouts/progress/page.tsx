import { redirect } from "next/navigation";

/** The lift list moved into Progress. */
export default function LiftProgressPage() {
  redirect("/app/progress");
}
