import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/** Shown on the diary and the booking screen while the rota is on and the week has no shifts. */
export function RotaUnfilledBanner({ week }: { week: string }) {
  return (
    <div className="rv-banner is-warn" role="status">
      <AlertTriangle size={15} aria-hidden />
      <span>This week&apos;s rota is not filled in, so bookings assume one person on.</span>
      <Link href={`/appointments/rota?week=${week}`} className="rv-banner-link">
        Fill in the rota
      </Link>
    </div>
  );
}
