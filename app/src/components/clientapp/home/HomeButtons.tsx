// app/src/components/clientapp/home/HomeButtons.tsx
/** A 2 x 2 grid of plain buttons: a bold label, a small line under it, no icons. */
import Link from "next/link";

import type { FeatureButton } from "./homeModel";

export function HomeButtons({ buttons }: { buttons: FeatureButton[] }) {
  if (buttons.length === 0) return null;
  return (
    <div className="pk-fgrid">
      {buttons.map((b) => (
        <Link key={b.key} href={b.href} className="pk-fbtn">
          <span className="pk-fbtn-head">
            <b className="pk-fbtn-label">{b.label}</b>
            {b.badge && <span className="pk-fbtn-badge">{b.badge}</span>}
          </span>
          <span className="pk-fbtn-line">{b.line}</span>
        </Link>
      ))}
    </div>
  );
}
