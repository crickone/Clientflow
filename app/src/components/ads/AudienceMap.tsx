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
  selected = -1,
  onPick,
  onSelect,
  height = 320,
}: {
  pins: MapPin[];
  /** Index of the pin the radius slider is editing; drawn emphasised. */
  selected?: number;
  /** A click on the map, to drop a pin there. */
  onPick: (lat: number, lng: number) => void;
  /** A click on an existing pin. */
  onSelect?: (index: number) => void;
  height?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const select = useRef(onSelect);
  select.current = onSelect;
  // Where the pins are (not how big): the map re-frames only when this changes,
  // so dragging the radius slider visibly grows the circle instead of the map
  // zooming out to keep it the same size on screen.
  const placesKey = pins.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");
  const framed = useRef("");

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

  // Redraw the pins whenever they change; re-frame only when one is added,
  // moved or removed.
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ff6a32";
    const bounds: L.LatLngBounds[] = [];
    pins.forEach((p, i) => {
      const on = i === selected;
      const circle = L.circle([p.lat, p.lng], {
        radius: p.radiusKm * 1000,
        color: accent,
        weight: on ? 3 : 1.5,
        fillColor: accent,
        fillOpacity: on ? 0.2 : 0.1,
        bubblingMouseEvents: false,
      }).addTo(g);
      circle.on("click", () => select.current?.(i));
      L.circleMarker([p.lat, p.lng], { radius: on ? 7 : 5, color: "#fff", weight: 2, fillColor: accent, fillOpacity: 1, bubblingMouseEvents: false })
        .bindTooltip(`${p.name} + ${p.radiusKm} km`)
        .on("click", () => select.current?.(i))
        .addTo(g);
      bounds.push(circle.getBounds());
    });
    if (bounds.length && framed.current !== placesKey) {
      framed.current = placesKey;
      const all = bounds.reduce((acc, b) => acc.extend(b), L.latLngBounds(bounds[0].getSouthWest(), bounds[0].getNorthEast()));
      // Room for the circle to grow to the 80 km limit without leaving the view.
      m.fitBounds(all.pad(0.6), { maxZoom: 11 });
    }
    if (!bounds.length) framed.current = "";
  }, [pins, selected, placesKey]);

  return (
    <div
      ref={host}
      role="application"
      aria-label="Map of where the ads show. Click to drop a pin."
      style={{ height, width: "100%", borderRadius: "var(--radius)", overflow: "hidden", border: "1px solid var(--hairline)", cursor: "crosshair", zIndex: 0 }}
    />
  );
}
