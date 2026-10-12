// Dev-only: throws so the crash screen can be looked at. 404s in production.
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export default function Problem() {
  if (process.env.NODE_ENV === "production") notFound();
  throw new Error("Deliberate test crash");
}
