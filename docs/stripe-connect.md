# Stripe Connect: selling offers from campaign pages

Businesses connect their OWN Stripe account (Stripe Connect, Standard
accounts, OAuth). Buyers pay on Stripe Checkout; the money, the customer
and the payout belong to the business's Stripe. The platform stores only the
connected account id (control table `stripe_connections`), never a business
key. Code: `app/src/lib/stripe`, `app/src/lib/offers`.

## One-time platform setup (done once, by the platform owner)

1. **A Stripe account for the platform** (Vantaige Limited), activated for
   live payments.
2. **Turn on Connect:** Dashboard > Connect > Get started. Fill in the
   platform profile Stripe asks for.
3. **OAuth:** Connect > Settings (Onboarding options > OAuth):
   - switch on OAuth for Standard accounts;
   - add the redirect URI `https://app.adonisagent.ie/api/stripe/callback`;
   - copy the **live** client ID (`ca_...`). Test mode has a different one.
4. **Secret key:** Developers > API keys > Secret key (`sk_live_...`).
5. **Webhook:** Developers > Webhooks > Add endpoint:
   - URL `https://app.adonisagent.ie/api/stripe/webhook`;
   - choose **Events on Connected accounts**;
   - events: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`, `checkout.session.expired`,
     `charge.refunded`, `account.updated`, `account.application.deauthorized`;
   - copy the signing secret (`whsec_...`).
6. **Railway variables** on the app service, then redeploy:
   `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_WEBHOOK_SECRET`.

`STRIPE_API_BASE` / `STRIPE_CONNECT_BASE` exist only for local tests against
a mock. Never set them in production.

## Each business

1. Settings > Stripe > **Connect with Stripe**, signed in as an admin of that
   business. Sign in to the business's Stripe and approve.
2. The Settings page shows "Taking payments" once Stripe has switched on
   charges for that account.

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
