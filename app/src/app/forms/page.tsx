import { redirect } from "next/navigation";

// Forms has no index of its own: dashboard widgets link to /forms, so send
// them to the website contact form, which is where submissions come from.
export default function FormsIndex() {
  redirect("/forms/contact");
}
