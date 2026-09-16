/**
 * What a dialog's button says while a long call runs.
 *
 * Past about 400ms a wait needs feedback or it reads as broken (the Doherty
 * threshold), and a bare "Designing…" for forty seconds is feedback only in
 * the first two of them. The seconds make time visibly pass; the step count
 * makes the two-request photo path say which request it is on. Pure, so the
 * copy is pinned by a test rather than left to drift.
 */

export type DialogPhase =
  | "reading"
  | "designing"
  | "photo"
  | "photoThenDesign"
  | "editingPhoto"
  | "editingPhotoThenDesign"
  | "applyingPhoto";

const WORDING: Record<DialogPhase, string> = {
  // The classification that picks the route. Under a second, but a button
  // that sits dead while it runs reads as broken (Doherty), and naming the
  // step is also what makes the routing visible rather than magic.
  reading: "Reading your request…",
  designing: "Designing…",
  photo: "Making the photo…",
  photoThenDesign: "Making the photo (1 of 2)…",
  // An edit is slower than a generation -- a measured one took 17 seconds at
  // the cheapest quality -- so it says what it is doing rather than borrowing
  // "Making the photo…", which would read as stuck on the picture that is
  // already there.
  editingPhoto: "Editing the photo…",
  editingPhotoThenDesign: "Editing the photo (1 of 2)…",
  applyingPhoto: "Adding the photo to the slide…",
};

/** Seconds are shown once a few have passed: "1s" flickering on is a glitch, not information. */
const SHOW_SECONDS_FROM = 3;

export function progressLabel(phase: DialogPhase, elapsedSeconds: number): string {
  const s = Math.floor(elapsedSeconds);
  const base = WORDING[phase];
  return s >= SHOW_SECONDS_FROM ? `${base} ${s}s` : base;
}
