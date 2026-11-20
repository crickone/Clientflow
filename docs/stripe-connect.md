# Stripe Connect: selling offers from campaign pages

Each business takes payments into its OWN Stripe account (Stripe Connect,
Stripe-hosted onboarding). Buyers pay on Stripe Checkout; the money, the
customer and the payout belong to the business's Stripe. The platform stores
only the connected account id (control table `stripe_connections`), never a
business key. Code: `app/src/lib/stripe`, `app/src/lib/offers`.

The live platform profile is "Onboarding hosted by Stripe" with the "Stripe
Dashboard" experience, which has no OAuth client id. So the platform creates
each business's account itself, with Standard-style controller settings (own
full Stripe dashboard, Stripe carries negative balances, the business pays
its own Stripe fees) and sends the owner to an account link to fill it in.
(Until 2026-11-20 this used OAuth; the test sandbox still has an OAuth client
id, but nothing reads it now.)

## One-time platform setup (done once, by the platform owner)

1. **A Stripe account for the platform** (Vantaige Limited), activated for
   live payments. Done 2026-11-20.
2. **Connect** set up with "merchants collect payments directly". Done.
   Leave Settings > Connect > Platform profile alone: negative balance
   liability stays with Stripe. Do NOT submit its "Acknowledge" form, which
   asks Stripe to move the liability to the platform.
3. **Secret key:** Developers > API keys > Create secret key > "Building your
   own integration" > Full access (`sk_live_...`).
4. **Webhook:** Developers > Webhooks > Add endpoint:
   - URL `https://app.adonisagent.ie/api/stripe/webhook`;
   - choose **Events on Connected accounts**;
   - events: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`, `checkout.session.expired`,
     `charge.refunded`, `account.updated`, `account.application.deauthorized`;
   - copy the signing secret (`whsec_...`).
5. **Railway variables** on the app service, then redeploy:
   `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (no trailing space or
   newline). `STRIPE_CONNECT_CLIENT_ID` is no longer read.

`STRIPE_API_BASE` exists only for local tests against a mock. Never set it
in production.

A connection made with the test key can't be used with the live key (and the
reverse): it counts as not connected, and the business connects again.

## Each business

1. Settings > Stripe > **Connect with Stripe**, signed in as an admin of that
   business. Adonis makes the business's Stripe account and opens Stripe's
   own page to add the business, identity and bank details.
2. Back in Adonis, "Continue in Stripe" reopens that page if they stopped
   part way. The Settings page shows "Taking payments" once Stripe has
   switched on charges (the account.updated webhook, or Check status).
3. Buy buttons only show once charges are on.
4. The business signs in to its account at dashboard.stripe.com with the
   email it was made with. Disconnecting in Adonis only forgets it here;
   connecting again makes a new account.

## Selling an offer

1. Build the campaign with Adonis and approve its landing page.
2. Campaign page > **Sell online**: name, price, usual price (optional; must
   be the lowest price charged in the previous 30 days), the services and
   session counts, how many for sale, sale start/end, use-by date, terms.
3. **Put on sale.** The landing page swaps its sign-up form for the Buy box
   (the form stays behind "Have a question first?").

When someone pays (webhook, or the buyer's return to the page, whichever is
first; a conditional UPDATE makes sure only one fulfils):
- the client is found by email or created;
- one session bundle (packages row) per service, used by the use-by date,
  with the price split across them by usual value;
- one card payment for the order, which moves their lead on the campaign's
  board to won;
- a confirmation email from the business;
- the Meta pixel gets a Purchase event, if the visitor accepted cookies.

A refund made in Stripe marks the order refunded and switches its bundles off.
Open checkouts hold a place for 35 minutes, so the last one can't sell twice.
