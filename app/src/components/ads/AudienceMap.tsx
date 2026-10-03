"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * The ad audience map: every pin with its radius circle, click to drop a new
 * pin. Plain Leaflet (no React wrapper) with OpenStreetMap tiles; loaded on
 * the client only (next/dynamic, ssr: false) because Leaflet needs window.
 * Pins are drawn as circle markers, so no marker image assets are needed.
 */

export interface MapPin {
  lat: number;
  lng: number;
  radiusKm: number;
  name: string;
}

const IRELAND: L.LatLngTuple = [53.4, -8.0];

export default function AudienceMap({
  pins,
  onPick,
  height = 320,
}: {
  pins: MapPin[];
  /** A click on the map, to drop a pin there. */
  onPick: (lat: number, lng: number) => void;
  height?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  // Create the map once.
  useEffect(() => {
    if (!host.current || map.current) return;
    const m = L.map(host.current, { center: IRELAND, zoom: 6, scrollWheelZoom: false, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      className: "audience-map-tiles",
    }).addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => pick.current(e.latlng.lat, e.latlng.lng));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Redraw the pins and frame them whenever they change.
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ff6a32";
    const bounds: L.LatLngBounds[] = [];
    for (const p of pins) {
      const circle = L.circle([p.lat, p.lng], { radius: p.radiusKm * 1000, color: accent, weight: 2, fillColor: accent, fillOpacity: 0.15 }).addTo(g);
      L.circleMarker([p.lat, p.lng], { radius: 6, color: "#fff", weight: 2, fillColor: accent, fillOpacity: 1 })
        .bindTooltip(`${p.name} + ${p.radiusKm} km`)
        .addTo(g);
      bounds.push(circle.getBounds());
    }
    if (bounds.length) {
      const all = bounds.reduce((acc, b) => acc.extend(b), L.latLngBounds(bounds[0].getSouthWest(), bounds[0].getNorthEast()));
      m.fitBounds(all, { padding: [24, 24], maxZoom: 12 });
    }
  }, [pins]);

  return (
    <div
      ref={host}
      role="application"
      aria-label="Map of where the ads show. Click to drop a pin."
      style={{ height, width: "100%", borderRadius: "var(--radius)", overflow: "hidden", border: "1px solid var(--hairline)", cursor: "crosshair", zIndex: 0 }}
    />
  );
}
