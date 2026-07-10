/**
 * Venue-neutral vocabulary. The internal data model is identical across venue
 * types; only the user-facing labels differ. A clinic sees Clients/Therapies/
 * Appointments/Packages; a gym sees Members/Classes/Bookings/Memberships.
 *
 * Client-safe (no server-only imports) so the VocabProvider/useVocab hook and
 * client components can use it. The active venue type is read server-side via
 * lib/settings.getVenueType() and passed down through VocabProvider.
 *
 * Grow the Vocab interface only as strings are actually migrated, so it stays a
 * faithful inventory of what has been made venue-neutral.
 */
export type VenueType = "clinic" | "gym";

export interface Vocab {
  member: string;
  members: string;
  service: string;
  services: string;
  booking: string;
  bookings: string;
  plan: string;
  plans: string;
  /** Imperative verb for creating a booking, e.g. "Book". */
  bookVerb: string;
  /**
   * Full CTA for creating a booking. Clinic and gym diverge here — a clinic
   * "books an appointment" while a gym "books a class" — so this is a phrase,
   * not verb+noun, to read naturally in both.
   */
  bookCta: string;
}

export const VOCAB: Record<VenueType, Vocab> = {
  clinic: {
    member: "Client",
    members: "Clients",
    service: "Therapy",
    services: "Therapies",
    booking: "Appointment",
    bookings: "Appointments",
    plan: "Package",
    plans: "Packages",
    bookVerb: "Book",
    bookCta: "Book appointment",
  },
  gym: {
    member: "Member",
    members: "Members",
    service: "Class",
    services: "Classes",
    booking: "Booking",
    bookings: "Bookings",
    plan: "Membership",
    plans: "Memberships",
    bookVerb: "Book",
    bookCta: "Book class",
  },
};

export function getVocab(venueType: VenueType): Vocab {
  return VOCAB[venueType] ?? VOCAB.clinic;
}
