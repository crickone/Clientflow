/**
 * The render URL, for client components.
 *
 * `renderStore.ts` is `server-only` -- it touches the filesystem -- but the
 * editor needs to build the same URL to show a designed slide. This is the one
 * piece of that module with no server dependency, kept here so a client
 * component can import it without dragging `node:fs` into the browser bundle.
 * It is the mirror of `libraryFileUrl` in paintSlide.ts, which exists for the
 * same reason.
 */
export function renderFileUrl(filename: string): string {
  return `/api/content-studio/renders/${encodeURIComponent(filename)}`;
}
