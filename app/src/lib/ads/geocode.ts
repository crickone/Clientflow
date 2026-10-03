import "server-only";

/**
 * Place search for the ad audience map: a typed place to coordinates, via
 * OpenStreetMap's Nominatim. Meta's own location search returns keys but no
 * coordinates, so it cannot put a pin on a map. Nominatim's usage policy asks
 * for an identifying User-Agent, at most one request a second and attribution
 * (shown on the map); a search runs only when the operator presses it.
 * Fail-soft: a failure is an empty list, never a thrown error.
 */
export interface PlaceResult {
  name: string;
  label: string;
  lat: number;
  lng: number;
}

export async function searchPlaces(q: string): Promise<PlaceResult[]> {
  const query = q.trim().slice(0, 120);
  if (!query) return [];
  try {
    const res = await fetch(
      "https://nominatim.openstreetmap.org/search?" +
        new URLSearchParams({ q: query, format: "jsonv2", limit: "6", addressdetails: "0", "accept-language": "en" }),
      { headers: { "User-Agent": "AdonisAgent/1.0 (hello@adonisagent.ie)" }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{ name?: string; display_name?: string; lat?: string; lon?: string }>;
    return rows
      .map((r) => ({
        name: r.name || (r.display_name ?? "").split(",")[0] || query,
        label: (r.display_name ?? "").split(",").slice(0, 3).join(",").trim(),
        lat: Number(r.lat),
        lng: Number(r.lon),
      }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  } catch {
    return [];
  }
}
