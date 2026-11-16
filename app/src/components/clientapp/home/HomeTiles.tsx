// app/src/components/clientapp/home/HomeTiles.tsx
/**
 * A row of small tiles: a label, the number, a thin bar where a target
 * exists. Three or more scroll sideways inside the row; one or two share it.
 * Nothing renders when there are none.
 */
import type { Tile } from "./homeModel";

export function HomeTiles({ tiles }: { tiles: Tile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div className={`pk-tiles${tiles.length >= 3 ? " pk-tiles--scroll" : ""}`} data-count={tiles.length}>
      {tiles.map((t) => (
        <div key={t.key} className="pk-tile">
          <span className="pk-tile-label">{t.label}</span>
          <b className="pk-tile-value">{t.value}</b>
          {t.pct !== null && (
            <div className="pk-tile-bar" role="progressbar" aria-label={t.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(t.pct * 100)}>
              <i style={{ width: `${Math.round(t.pct * 100)}%` }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
