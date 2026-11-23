# Voucher store: design

Date: 2026-11-23. Status: approved in conversation, awaiting spec review.

## Goal

Each business gets a branded online store where customers buy digital gift
vouchers, paid into the business's own Stripe account, delivered as a branded
"reveal" voucher, and redeemed by staff in the existing voucher module (with
balances). Optimal Health first; it replaces their voucherconnect store.

## Decisions (from the user)

- **What's for sale:** money amounts (preset amounts, plus an optional amount the
  buyer types, within a minimum and maximum) AND treatment vouchers (one session
  of a named therapy at its list price).
- **Store layout:** the voucher builder. One page: a live preview of the voucher
  on the left, choices on the right (what, who, colourway, delivery, pay).
- **Voucher design:** the reveal card. The recipient's page opens with
  "<From> sent you a gift", then a foil card in the business's brand colours that
  catches the light as the phone tilts (builds on the existing
  `HolographicCard`). The builder preview shows the same card.
- **Delivery:** the buyer chooses: send it to me, or email it to the recipient
  now or on a date they pick (up to 12 months ahead).
- **Balances:** a money voucher keeps its unused balance for next time.
- **Platform fee:** none. The business keeps everything except Stripe's own fee.
- **Approach:** own voucher orders, sharing the existing Stripe Connect plumbing
  (not built on campaign offers, not Stripe Payment Links).

## Legal floor

Irish law (Consumer Rights Act 2022): gift vouchers must be valid for at least
5 years. Expiry is purchase date + the business's setting, which cannot be set
below 5 years. Expired vouchers show a warning to staff but can still be
accepted.

## Business setup (staff)

Products > Vouchers > Online store (admin only), behind the module flag
`voucher_store` (defaultRollout "none"):

- Store on / off. When on, the store is live at `/vouchers` on the business's
  site (their domain in production).
- Preset amounts (list of whole euros), custom amount allowed (yes/no) with
  minimum and maximum (defaults EUR 25 to EUR 500).
- Treatments on sale: ticked from the business's active therapies; price and
  name come from the therapy, so they follow the service list.
- Intro line for the store page (optional, plain text, max 200 characters).
- Expiry in years (minimum 5, default 5).
- Shown only when Stripe can take payments (`canTakePayments`); otherwise the
  page explains that Stripe must be connected first.

Stored as the tenant setting key `voucher_store`.

## Buyer flow (public, `/vouchers`)

Inside the business's own site chrome (`lib/cms/siteChrome`), like campaign
landing pages. Steps on one page, preview updating live:

1. What: a preset amount, "Other amount" (validated against min/max), or a
   treatment.
2. Who: To (recipient name), From (buyer's name as shown on the card), optional
   message (max 200 characters).
3. Look: 3 or 4 foil colourways generated from the business's brand palette
   (pure function of the palette, so every business gets its own set).
4. Delivery: "Send it to me" (buyer email) or "Email it to <recipient>"
   (recipient email) "now" or "on <date>" (today to +12 months).
5. Buyer's email (required) and name, then Pay: Stripe Checkout on the
   business's connected account.

Return page: "Thank you" with the voucher preview and what happens next; it
also confirms the payment with Stripe if the webhook has not arrived yet.

One voucher per checkout. Quantity, discount codes, corporate bulk orders,
Apple Wallet and PDF files are out of scope.

## Recipient flow

- Email: branded "<From> sent you a gift" with one button. Sent on the chosen
  day at 09:00 Europe/Dublin, or immediately.
- Reveal page `/v/<token>` (unguessable token, separate from the short code),
  inside the business's site chrome: the gift moment, then the foil card with
  amount or treatment, code, message, current balance ("EUR 20 left"), expiry,
  and "Book with this voucher" (the business's normal booking route; for
  Optimal Health, phone). A Print view for buyers who give it in person.

## Staff flow

- Existing voucher list shows online vouchers ("Bought online", order, buyer,
  recipient, delivery status) with balance.
- Voucher detail: balance, redemption history, resend gift email, change
  recipient email, mark delivery failed/resent.
- At booking, payment method "Voucher": staff enter the code and see type,
  balance, expiry, who it is for. Money voucher covers up to its balance; any
  remainder is recorded as a second payment by another method. Treatment
  voucher covers one session of its therapy whatever the current price, then is
  used up. Each use is one `voucher_redemptions` row.
- Refund in Stripe (`charge.refunded`): an unused voucher is cancelled (balance
  0); a part-used one is flagged for staff.

## Data

- Setting `voucher_store` (JSON): enabled, amounts[], allowCustom, customMin,
  customMax, therapyIds[], intro, expiryYears.
- New tenant table `voucher_orders`: id, kind (amount | treatment), value_cents,
  therapy_id, buyer_name, buyer_email, recipient_name, recipient_email,
  from_name, message, colourway, deliver_to (buyer | recipient), deliver_on
  (YYYY-MM-DD or null = now), status (pending | paid | expired | refunded),
  stripe_account_id, stripe_session_id (unique), payment_intent_id,
  gift_voucher_id, delivered_at, delivery_error, created_at, paid_at.
- `gift_vouchers` gains: source (staff | online, default staff),
  voucher_order_id, message, colourway, view_token (unique), cancelled_at.
- New tenant table `voucher_redemptions`: id, voucher_id, amount_eur,
  appointment_id, payment_id, redeemed_by_user_id, created_at. Balance = value
  minus the sum of redemptions (kept in `balance_eur` for fast reads, updated in
  the same transaction).

## Architecture

New folder `app/src/lib/vouchers/`, one job per file:

- `model.ts` (pure): store-settings validation (5-year floor), amount
  validation, expiry date, colourways from a palette, balance and payment split,
  delivery time (09:00 Dublin on deliver_on).
- `store.ts`: reads and writes for settings, orders, vouchers, redemptions.
- `checkout.ts`: create pending order, open Stripe Checkout on the connected
  account (reuse `lib/stripe/api` createCheckoutSession and the Connect header),
  metadata `kind=voucher`, `tenant_id`, `voucher_order_id`.
- `fulfil.ts`: claim the order with one conditional UPDATE (webhook and return
  page can both call it; only one wins), create the gift voucher (code, token,
  expiry), send the buyer receipt, send or schedule the gift.
- `deliver.ts`: send due gift emails (called by the minute dispatch ticker);
  records delivered_at / delivery_error.
- `redeem.ts`: look up by code, apply a redemption (split payment), cancel on
  refund.
- `email.ts`: buyer receipt and recipient gift emails, branded per business
  (logo, colours, name).

UI: `components/vouchers/VoucherBuilder.tsx`, `components/vouchers/RevealCard.tsx`
(generalised from `app/vouchers/[code]/HolographicCard.tsx`). Routes: site
`/vouchers` page, site `/v/[token]` page, `api/vouchers/checkout`, admin
settings page under Products > Vouchers.

Stripe webhook (`api/stripe/webhook`): route `checkout.session.completed`,
`checkout.session.expired` and `charge.refunded` with `kind=voucher` metadata to
`lib/vouchers`; everything else is unchanged.

Email sending: `sendEmailForTenant` (the business's own Gmail or domain). If the
business has no sender, fall back to `sendPlatformEmail` with fromName
"<Business> via AdonisAgent" and replyTo the business email. This is a
deliberate exception to "platform email is for account notices only", limited
to voucher receipts and gifts so a sale is never left undelivered.

Rebrand: the existing Renova-hardcoded voucher page and email
(`app/vouchers/[code]`, `lib/voucherEmail.ts`) are rebuilt on the business's own
logo, colours and name.

## Errors

- Stripe not ready: the store shows "not taking orders yet" and no Buy button.
- Checkout fails to open: the builder shows the reason; nothing is charged.
- Webhook late or lost: the return page confirms with Stripe; the shared claim
  keeps it to one voucher.
- Gift email fails: delivery_error set, staff see it with Resend; the buyer's
  receipt always carries the voucher link.
- Unknown or used-up code at the desk: a clear message, nothing recorded.

## Testing

- Unit tests (pure): settings validation incl. the 5-year floor, amount
  bounds, expiry, colourways, balance and split, 09:00 Dublin delivery time
  across DST.
- Integration with a scratch tenant and the existing mock Stripe: checkout,
  fulfil once from both webhook and return page, scheduled delivery via the
  ticker, refund cancel, redemption with remainder.
- Browser check: builder and reveal at 390px and 1280px, light and dark site.
- Live: on Optimal Health, one real EUR 25 voucher bought and refunded.

## Rollout

Deploy with `voucher_store` off. Switch on for Optimal Health (tenant 1028),
set their amounts and treatments, do the real test purchase, then point their
site's "Vouchers" link and FAQ 5 at `/vouchers` instead of voucherconnect.
