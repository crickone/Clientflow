export interface ConsoleView { id: string; name: string; href: string }

/** Always there, under the person's own. */
export const BUILT_IN_VIEWS: ConsoleView[] = [
  { id: "past-due", name: "Past due", href: "/gyms?status=past_due" },
  { id: "awaiting", name: "Awaiting payment", href: "/gyms?status=pending_payment" },
  { id: "archived", name: "Archived", href: "/gyms?status=archived" },
  { id: "refused", name: "Refused actions", href: "/audit?ok=0" },
];
