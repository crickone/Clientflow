"use client";

import { useMemo, useState } from "react";

import { useVocab } from "@/components/providers/VocabProvider";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { clientSubline, displayName, initials, searchClients } from "@/lib/booking/clientSearch";
import type { PrepaidOffer } from "@/lib/booking/packageChoiceModel";
import type { Client } from "@/lib/db/schema";

import { PrepaidBanner } from "./PrepaidBanner";
import s from "./booking.module.css";

export interface WalkIn {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

interface Props {
  clients: Client[];
  mode: "existing" | "walk_in";
  onMode: (mode: "existing" | "walk_in") => void;
  clientId: number | null;
  onClientId: (id: number | null) => void;
  walkIn: WalkIn;
  onWalkIn: (next: WalkIn) => void;
  /** One per usable prepaid package the selected client has. */
  offers: PrepaidOffer[];
  /** The package paying for this booking, when one is. */
  usingPackageId: number | null;
  onUseOffer: (offer: PrepaidOffer, use: boolean) => void;
}

/** Card 1: who the booking is for. Existing client (search) or walk-in, plus their prepaid sessions. */
export function ClientCard({ clients, mode, onMode, clientId, onClientId, walkIn, onWalkIn, offers, usingPackageId, onUseOffer }: Props) {
  const vocab = useVocab();
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchClients(clients, query), [clients, query]);
  const selected = clientId != null ? clients.find((c) => c.id === clientId) ?? null : null;
  const member = vocab.member.toLowerCase();

  return (
    <Card>
      <div className={s.cardHead}>
        <CardLabel style={{ marginBottom: 0 }}>{vocab.member}</CardLabel>
        {mode === "existing" && selected ? (
          <button type="button" className={s.link} onClick={() => onClientId(null)}>
            Change
          </button>
        ) : (
          <div className={s.chips} role="group" aria-label={`${vocab.member} type`}>
            {(
              [
                ["existing", "Existing"],
                ["walk_in", "Walk-in"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                className={`${s.chip} ${s.chipSm} ${mode === value ? s.chipOn : ""}`}
                onClick={() => onMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === "existing" ? (
        selected ? (
          <>
            <div className={s.who}>
              <div className={s.avatar} aria-hidden>
                {initials(selected.firstName, selected.lastName)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className={s.whoName}>{displayName(selected.firstName, selected.lastName)}</div>
                <div className={s.whoSub}>{clientSubline(selected.phone, selected.createdAt, vocab.member)}</div>
              </div>
            </div>
            {offers.map((offer) => (
              <PrepaidBanner
                key={offer.packageId}
                offer={offer}
                firstName={selected.firstName}
                using={usingPackageId === offer.packageId}
                onToggle={(use) => onUseOffer(offer, use)}
              />
            ))}
          </>
        ) : (
          <>
            <Label htmlFor="booking-client-search" srOnly>
              Search {member}s
            </Label>
            <Input
              id="booking-client-search"
              placeholder={`Search ${member} by name, email or phone`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
            <div className={s.results}>
              {results.map((c) => (
                <button key={c.id} type="button" className={s.result} onClick={() => onClientId(c.id)}>
                  {displayName(c.firstName, c.lastName)}
                  <span className={s.resultSub}>{c.phone}</span>
                </button>
              ))}
              {results.length === 0 && <div className={s.muted}>No matches.</div>}
            </div>
          </>
        )
      ) : (
        <>
          <p className={s.muted} style={{ margin: "0 0 12px" }}>
            For voucher redemptions or one-off visits. A {member} record is made from what you fill in. Only the first name is needed.
          </p>
          <div className={s.walkGrid}>
            <div>
              <Label htmlFor="walkInFirstName" srOnly>
                First name
              </Label>
              <Input
                id="walkInFirstName"
                placeholder="First name *"
                value={walkIn.firstName}
                onChange={(e) => onWalkIn({ ...walkIn, firstName: e.target.value })}
                required
              />
            </div>
            <div>
              <Label htmlFor="walkInLastName" srOnly>
                Last name
              </Label>
              <Input
                id="walkInLastName"
                placeholder="Last name"
                value={walkIn.lastName}
                onChange={(e) => onWalkIn({ ...walkIn, lastName: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="walkInEmail" srOnly>
                Email (optional)
              </Label>
              <Input
                id="walkInEmail"
                type="email"
                placeholder="Email (optional)"
                value={walkIn.email}
                onChange={(e) => onWalkIn({ ...walkIn, email: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="walkInPhone" srOnly>
                Phone (optional)
              </Label>
              <Input
                id="walkInPhone"
                placeholder="Phone (optional)"
                value={walkIn.phone}
                onChange={(e) => onWalkIn({ ...walkIn, phone: e.target.value })}
              />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
