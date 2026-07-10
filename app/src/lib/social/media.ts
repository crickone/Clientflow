import "server-only";

/**
 * Content Studio images are served at
 *   /api/content-studio/image-library/file/<filename>
 * The auth middleware exempts paths ending in .png/.jpg/.webp AND that route
 * handler does not check the session — so these URLs are ALREADY publicly
 * fetchable. Meta (Instagram especially) fetches the image from the absolute
 * https URL server-side, so we just need to make it absolute.
 */
export function libraryImagePath(filename: string): string {
  return `/api/content-studio/image-library/file/${encodeURIComponent(filename)}`;
}

/** Absolute, publicly-fetchable URL for a library image, given the request origin. */
export function publicImageUrl(origin: string, filename: string): string {
  return `${origin.replace(/\/$/, "")}${libraryImagePath(filename)}`;
}
