"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useVocab } from "@/components/providers/VocabProvider";
import {
  EMPTY_NEW_PACKAGE,
  bookingFormData,
  bookingProblem,
  readyToBook,
  templateStillFits,
  type BookingDraft,
  type NewPackageDraft,
} from "@/lib/booking/bookingPayload";
import { chipTime, shortDate } from "@/lib/booking/format";
import { displayName, splitName } from "@/lib/booking/clientSearch";
import {
  packagesFor,
  prepaidOffers,
  reconcilePackageChoice,
  sameChoice,
  type PaymentChoice,
  type PaymentMethod,
  type PrepaidOffer,
  type UsablePackage,
} from "@/lib/booking/packageChoiceModel";
import type { StripDay } from "@/lib/booking/slotModel";
import { bookLabel, summaryMoney, whenLabel, type SecondaryMethod } from "@/lib/booking/summaryModel";
import { familyOf, groupTreatments } from "@/lib/booking/treatmentGroups";
import { voucherCoverage } from "@/lib/booking/voucherModel";
import { perSessionValue } from "@/lib/packageBalanceModel";
import type { Client, PackageTemplate, Therapy } from "@/lib/db/schema";

import { BookingBar, BookingSummary } from "./BookingSummary";
import { ClientCard, type WalkIn } from "./ClientCard";
import { PaymentCard } from "./PaymentCard";
import { TreatmentCard } from "./TreatmentCard";
import { WhenCard } from "./WhenCard";
import { useVoucherLookup } from "./useVoucherLookup";
import s from "./booking.module.css";

interface Props {
  therapies: Therapy[];
  clients: Client[];
  packageTemplates: PackageTemplate[];
  /** The 14-day strip, closed days marked (opening hours and block-outs). */
  strip: StripDay[];
  /** The booking's date: ?date=, else today in Dublin. */
  defaultDate: string;
  defaultClientId?: number;
  defaultStartTime?: string;
  defaultVoucherCode?: string;
  defaultTherapyId?: number;
  /** Arriving from a voucher redemption: the recipient's name is the walk-in starting point. */
  defaultWalkInName?: string;
}

/** The method a booking starts on and falls back to. */
const FALLBACK: PaymentMethod = "cash";

/**
 * /appointments/new: the form on the left (client, treatment, when, payment)
 * and a live Booking summary with the Book button on the right. Posts the
 * same body to /api/appointments the old BookingForm did (lib/booking/bookingPayload).
 */
export function NewBooking({
  therapies,
  clients,
  packageTemplates,
  strip,
  defaultDate,
  defaultClientId,
  defaultStartTime,
  defaultVoucherCode,
  defaultTherapyId,
  defaultWalkInName,
}: Props) {
  const router = useRouter();
  const vocab = useVocab();

  // ------------------------------------------------------------ client
  // A ?client= that is not a positive id on the list (NaN, 0, a stranger) is ignored.
  const seedClientId =
    defaultClientId != null && Number.isInteger(defaultClientId) && defaultClientId > 0 && clients.some((c) => c.id === defaultClientId)
      ? defaultClientId
      : null;
  const [clientMode, setClientMode] = useState<"existing" | "walk_in">(defaultWalkInName && seedClientId == null ? "walk_in" : "existing");
  const [clientId, setClientId] = useState<number | null>(seedClientId);
  const [walkIn, setWalkIn] = useState<WalkIn>(() => {
    const [firstName, lastName] = splitName(defaultWalkInName);
    return { firstName, lastName, email: "", phone: "" };
  });
  const client = clientId != null ? clients.find((c) => c.id === clientId) ?? null : null;

  // ------------------------------------------------------------ treatment
  const groups = useMemo(() => groupTreatments(therapies), [therapies]);
  const therapyById = useMemo(() => new Map(therapies.map((t) => [t.id, t])), [therapies]);
  const [therapyId, setTherapyId] = useState<number | null>(defaultTherapyId ?? null);
  const therapy = therapyId != null ? therapyById.get(therapyId) ?? null : null;
  const [duration, setDuration] = useState(0);
  const [price, setPrice] = useState(0);
  // A treatment brings its own length and list price; staff can still adjust both.
  useEffect(() => {
    setDuration(therapy?.defaultDurationMinutes ?? 0);
    setPrice(therapy?.defaultPriceEur ?? 0);
  }, [therapy]);

  // ------------------------------------------------------------ when
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState(defaultStartTime ?? "");

  // ------------------------------------------------------------ payment
  const [choice, setChoice] = useState<PaymentChoice>({
    paymentMethod: defaultVoucherCode ? "voucher" : FALLBACK,
    packageMode: "existing",
    packageId: null,
  });
  // Until staff pick a method themselves, a prepaid session pays by default.
  const methodChosen = useRef(Boolean(defaultVoucherCode));
  const [newPackage, setNewPackage] = useState<NewPackageDraft>(EMPTY_NEW_PACKAGE);
  // A package template belongs to one treatment: drop it when the treatment changes (the Length switch).
  useEffect(() => {
    setNewPackage((prev) => (templateStillFits(prev.templateId, therapyId, packageTemplates) ? prev : { ...prev, templateId: null }));
  }, [therapyId, packageTemplates]);
  const [voucherCode, setVoucherCode] = useState(defaultVoucherCode ?? "");
  const voucherInfo = useVoucherLookup(voucherCode, choice.paymentMethod === "voucher");
  const [secondary, setSecondary] = useState<SecondaryMethod>("card");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Every usable prepaid package the client has on the booking's date, any treatment.
  const [packages, setPackages] = useState<UsablePackage[]>([]);
  // The previous client's packages go as soon as the client changes, not when the next list arrives.
  useEffect(() => {
    setPackages([]);
  }, [clientId]);
  useEffect(() => {
    if (clientMode !== "existing" || clientId == null) {
      setPackages([]);
      return;
    }
    let live = true;
    fetch(`/api/packages?clientId=${clientId}&date=${encodeURIComponent(date)}`)
      .then((r) => r.json())
      .then((d: UsablePackage[]) => {
        if (live) setPackages(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        if (live) setPackages([]);
      });
    return () => {
      live = false;
    };
  }, [clientMode, clientId, date]);

  useEffect(() => {
    setChoice((prev) => {
      const next = reconcilePackageChoice(prev, packages, therapyId, methodChosen.current, FALLBACK);
      return sameChoice(prev, next) ? prev : next;
    });
  }, [packages, therapyId]);

  const fits = packagesFor(packages, therapyId);
  const offers = useMemo(() => prepaidOffers(packages, therapies), [packages, therapies]);
  const prepaidTherapyIds = useMemo(() => new Set(packages.filter((p) => p.available > 0).map((p) => p.therapyId)), [packages]);
  const pkg = choice.paymentMethod === "package" && choice.packageMode === "existing" ? fits.find((p) => p.id === choice.packageId) ?? null : null;
  // Paying from a package: the session is worth what the package cost per session.
  const sendPrice = pkg ? perSessionValue(pkg) : price;
  const listPrice = therapy?.defaultPriceEur ?? 0;
  const coverage = voucherCoverage(voucherInfo, therapyId, sendPrice, listPrice);

  function pickMethod(m: PaymentMethod) {
    methodChosen.current = true;
    if (m === "package") {
      const keep = fits.some((p) => p.id === choice.packageId);
      setChoice({ paymentMethod: "package", packageMode: "existing", packageId: keep ? choice.packageId : (fits[0]?.id ?? null) });
    } else setChoice((c) => ({ ...c, paymentMethod: m, packageMode: "existing" }));
  }

  function signUp(on: boolean) {
    methodChosen.current = true;
    if (on) setChoice((c) => ({ ...c, paymentMethod: "package", packageMode: "new" }));
    else setChoice({ paymentMethod: fits.length ? "package" : FALLBACK, packageMode: "existing", packageId: fits[0]?.id ?? null });
  }

  function toggleOffer(offer: PrepaidOffer, use: boolean) {
    methodChosen.current = true;
    if (use) {
      setTherapyId(offer.therapyId);
      setChoice({ paymentMethod: "package", packageMode: "existing", packageId: offer.packageId });
    } else {
      setChoice((c) => ({ ...c, paymentMethod: FALLBACK, packageMode: "existing" }));
    }
  }

  // ------------------------------------------------------------ the booking
  const draft: BookingDraft = {
    clientMode,
    clientId,
    walkIn,
    therapyIds: therapyId != null ? [therapyId] : [],
    date,
    startTime,
    durationMinutes: duration,
    priceEur: sendPrice,
    paymentMethod: choice.paymentMethod,
    packageMode: choice.packageMode,
    packageId: choice.packageId,
    newPackage,
    voucherCode,
    secondaryPaymentMethod: coverage.needsSplit ? secondary : null,
    notes,
  };

  const money = summaryMoney({
    listPrice,
    price: sendPrice,
    paymentMethod: choice.paymentMethod,
    packageMode: choice.packageMode,
    pkg,
    newPackage: (() => {
      if (choice.packageMode !== "new") return null;
      const tpl = newPackage.templateId != null ? packageTemplates.find((t) => t.id === newPackage.templateId) : null;
      return tpl ? { name: tpl.name, priceEur: tpl.priceEur } : { name: newPackage.name, priceEur: newPackage.priceEur };
    })(),
    voucher: choice.paymentMethod === "voucher" && voucherCode ? { ...coverage, valid: voucherInfo.state === "valid" } : null,
    secondaryMethod: secondary,
    planWord: vocab.plan.toLowerCase(),
  });

  const firstName = clientMode === "existing" ? client?.firstName ?? "" : walkIn.firstName.trim();
  const clientLabel =
    clientMode === "existing" ? (client ? displayName(client.firstName, client.lastName) : "") : displayName(walkIn.firstName, walkIn.lastName);
  const family = familyOf(groups, therapyId);
  const treatmentLabel = therapy ? `${family?.name ?? therapy.name}, ${duration} min` : "";
  const canBook = readyToBook(draft) && !submitting;
  const barTitle = therapy
    ? [family?.label ?? therapy.name, startTime ? `${shortDate(date)} ${chipTime(startTime)}` : shortDate(date)].join(", ")
    : `Pick a ${vocab.service.toLowerCase()}`;

  async function book() {
    const problem = bookingProblem(draft, vocab);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/appointments", { method: "POST", body: bookingFormData(draft) });
      const data = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; id?: number; error?: string };
      if (!data.ok) {
        toast.error(data.error ?? `Could not book ${vocab.booking.toLowerCase()}.`);
        setSubmitting(false);
        return;
      }
      toast.success(`${vocab.booking} booked.`);
      router.push(`/appointments/${data.id}`);
      router.refresh();
    } catch {
      toast.error(`Could not book ${vocab.booking.toLowerCase()}.`);
      setSubmitting(false);
    }
  }

  return (
    <div className={s.root}>
      <div className={s.layout}>
        <div className={s.main}>
          <ClientCard
            clients={clients}
            mode={clientMode}
            onMode={setClientMode}
            clientId={clientId}
            onClientId={setClientId}
            walkIn={walkIn}
            onWalkIn={setWalkIn}
            offers={offers}
            usingPackageId={pkg?.id ?? null}
            onUseOffer={toggleOffer}
          />
          <TreatmentCard groups={groups} therapyId={therapyId} onPick={setTherapyId} prepaidTherapyIds={prepaidTherapyIds} />
          <WhenCard
            strip={strip}
            date={date}
            onDate={setDate}
            startTime={startTime}
            onStartTime={setStartTime}
            durationMinutes={duration}
            therapyIds={draft.therapyIds}
          />
          <PaymentCard
            choice={choice}
            onMethod={pickMethod}
            onPackageId={(id) => setChoice((c) => ({ ...c, packageId: id }))}
            onSignUp={signUp}
            fits={fits}
            therapyId={therapyId}
            templates={packageTemplates}
            newPackage={newPackage}
            onNewPackage={setNewPackage}
            voucherCode={voucherCode}
            onVoucherCode={setVoucherCode}
            voucherInfo={voucherInfo}
            coverage={coverage}
            secondary={secondary}
            onSecondary={setSecondary}
            price={sendPrice}
            onPrice={setPrice}
            duration={duration}
            onDuration={setDuration}
            priceLocked={pkg != null}
            notes={notes}
            onNotes={setNotes}
          />
        </div>
        <aside className={s.side} aria-label="Booking summary">
          <BookingSummary
            client={clientLabel}
            treatment={treatmentLabel}
            when={whenLabel(date, startTime, duration)}
            money={money}
            bookLabel={bookLabel(firstName, vocab.bookCta)}
            canBook={canBook}
            submitting={submitting}
            onBook={book}
          />
        </aside>
      </div>
      <BookingBar title={barTitle} money={money} canBook={canBook} submitting={submitting} onBook={book} />
    </div>
  );
}
