import "server-only";

import { searchAdCities } from "./service";

/**
 * Place suggestions for the ad audience map, as the operator types.
 *
 * Two sources, because neither does both jobs:
 *  - Meta's location search (type=adgeolocation) is built for typeahead and
 *    matches prefixes well ("clonm" -> Clonmel), the same list Ads Manager
 *    shows, but returns no coordinates.
 *  - Photon (photon.komoot.io, OpenStreetMap data) returns coordinates and
 *    allows search-as-you-type (Nominatim's policy forbids it), but its prefix
 *    matching is weak.
 * So Meta's towns come first and are placed on the map by looking their full
 * name up in Photon when picked (resolvePlace); Photon's own places follow.
 * Fail-soft throughout: a source that errors contributes nothing.
 */

export interface PlaceSuggestion {
  name: string;
  /** Shown in the list: "Clonmel, Tipperary, Ireland". */
  label: string;
  /** Present when the coordinates are already known. */
  lat?: number;
  lng?: number;
}

const UA = { "User-Agent": "AdonisAgent/1.0 (hello@adonisagent.ie)" };
// Bigger places first: a town before a townland of the same name.
const RANK: Record<string, number> = { city: 0, town: 1, suburb: 2, district: 2, village: 3, quarter: 3, neighbourhood: 4, locality: 5, hamlet: 5 };

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; county?: string; state?: string; country?: string; osm_value?: string };
}

async function photon(q: string, limit: number): Promise<PhotonFeature[]> {
  try {
    const res = await fetch(
      "https://photon.komoot.io/api/?" +
        new URLSearchParams({ q, limit: String(limit), lang: "en", lat: "53.4", lon: "-8.0", osm_tag: "place" }),
      { headers: UA, signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return [];
    return ((await res.json()) as { features?: PhotonFeature[] }).features ?? [];
  } catch {
    return [];
  }
}

const labelOf = (p: NonNullable<PhotonFeature["properties"]>) =>
  [p.name, p.county ?? p.state, p.country].filter(Boolean).join(", ");

function ranked(features: PhotonFeature[]): PlaceSuggestion[] {
  const out: Array<PlaceSuggestion & { rank: number; i: number }> = [];
  const seen = new Set<string>();
  features.forEach((f, i) => {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    if (!p.name || !c) return;
    const label = labelOf(p);
    if (seen.has(label)) return;
    seen.add(label);
    out.push({ name: p.name, label, lng: c[0], lat: c[1], rank: RANK[p.osm_value ?? ""] ?? 6, i });
  });
  return out.sort((a, b) => a.rank - b.rank || a.i - b.i).map(({ name, label, lat, lng }) => ({ name, label, lat, lng }));
}

export async function suggestPlaces(q: string): Promise<PlaceSuggestion[]> {
  const query = q.trim().slice(0, 80);
  if (query.length < 2) return [];
  const [meta, osm] = await Promise.all([
    searchAdCities(query).catch(() => []),
    photon(query, 15),
  ]);
  const fromMeta: PlaceSuggestion[] = meta.slice(0, 5).map((c) => ({
    name: c.name,
    label: [c.name, c.region, c.country].filter(Boolean).join(", "),
  }));
  const metaNames = new Set(fromMeta.map((m) => m.name.toLowerCase()));
  const fromOsm = ranked(osm).filter((p) => !metaNames.has(p.name.toLowerCase()));
  return [...fromMeta, ...fromOsm].slice(0, 8);
}

/** Coordinates for a suggestion picked without them (a Meta town), by its full name. */
export async function resolvePlace(label: string): Promise<{ lat: number; lng: number } | null> {
  const best = ranked(await photon(label.slice(0, 120), 8))[0];
  return best?.lat != null && best.lng != null ? { lat: best.lat, lng: best.lng } : null;
}
