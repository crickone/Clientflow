import { notFound } from "next/navigation";
import { ToastDemo } from "./ToastDemo";
export const dynamic = "force-dynamic";
// Dev-only: shows every notification type. 404s in production.
export default function Toasts() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ToastDemo />;
}
