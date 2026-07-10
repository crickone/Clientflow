/**
 * Venue-neutral type aliases over the existing inferred row types. New code may
 * import these for readability (Member, Service, Booking, Plan) without renaming
 * the underlying tables or existing imports. Types only — zero runtime change.
 *
 * Mapping (clinic table -> neutral concept):
 *   clients  -> Member       therapies -> Service
 *   appointments -> Booking  packages  -> Plan
 */
import type {
  Client,
  NewClient,
  Therapy,
  Appointment,
  NewAppointment,
  Package,
  NewPackage,
  PackageTemplate,
  NewPackageTemplate,
} from "./db/schema";

export type Member = Client;
export type NewMember = NewClient;
export type Service = Therapy;
export type Booking = Appointment;
export type NewBooking = NewAppointment;
export type Plan = Package;
export type NewPlan = NewPackage;
export type PlanTemplate = PackageTemplate;
export type NewPlanTemplate = NewPackageTemplate;
