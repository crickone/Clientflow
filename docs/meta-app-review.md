# Meta App Review: Adonis Agent (app 1523436259079672)

Submission pack for advanced access. Paste each "How we use it" block into the
matching permission's request form (App Review > Permissions and features >
Request advanced access). Business: Vantaige Limited (portfolio 592006579899050).

## Before submitting (Meta blocks the submission without these)

- [ ] Business verification: done (2026-10-03).
- [ ] Access verification (Tech Provider), under App settings or the Required actions banner. Needed because businesses other than Vantaige connect their own assets.
- [ ] App settings > Basic, all saved:
  - App icon (1024x1024): `~/Desktop/adonis-app-icon.png` (or the .jpg / -512 versions if upload fails)
  - Privacy policy URL: `https://www.adonisagent.ie/privacy`
  - Data deletion instructions URL: `https://www.adonisagent.ie/data-deletion`
  - Category: Business and pages
  - App domains: `adonisagent.ie`, `app.adonisagent.ie`
- [ ] Data use checkup: complete it if the dashboard asks.
- [ ] Each permission needs at least one successful API call in the last 30 days. The "Request advanced access" button stays greyed out until then. Connecting, posting, opening the Social dashboard and a test ad cover all of them.

## Test account for the reviewer

Meta's reviewer needs to log in to AdonisAgent. Give them:
- URL: `https://app.adonisagent.ie/login`
- A dedicated admin login on a demo tenant (create one, do NOT reuse a real client login)
- Steps: Settings > Integrations > Facebook & Instagram > Connect Facebook

## Screencasts

Record in English, at a readable resolution, with no cuts in the middle of a flow.
Each video must show the Facebook login popup granting the permission, then the
feature in AdonisAgent, then the result on Facebook or Instagram.

1. **Connect** (used for every permission): AdonisAgent Settings > Facebook & Instagram > Connect Facebook > Meta popup (Page, Instagram, ad account) > back in AdonisAgent showing the Page, @handle, ad account chosen and the readiness checklist.
2. **Publishing**: Content Studio > a post > schedule or publish now > show it live on the Facebook Page and the Instagram profile.
3. **Messaging**: send a Messenger DM and an Instagram DM to the Page from another account > show them arriving in AdonisAgent's inbox > reply from AdonisAgent > show the reply arriving in Messenger / Instagram.
4. **Lead ads**: submit a lead form with Meta's Lead Ads Testing Tool (developers.facebook.com/tools/lead-ads-testing) > show the lead appearing in AdonisAgent > Leads.
5. **Ads**: Marketing > Ads > New campaign > build it (objective, audience, budget, creative) > launch > show it in Meta Ads Manager > pause it from AdonisAgent > show it paused in Ads Manager > show the results panel.
6. **Insights**: Dashboard > Social preset > follower counts, reach, Page views, top posts.

## How we use each permission

### pages_show_list
AdonisAgent is a business management platform for gyms, clinics and studios. When a business connects Facebook, we use pages_show_list to list the Pages the business chose to share, so they can confirm which Page AdonisAgent posts from, receives messages for and runs ads from. The list is shown on Settings > Integrations > Facebook & Instagram. Screencast 1.

### pages_manage_posts
Businesses plan and design their social posts in AdonisAgent's Content Studio and schedule them. At the scheduled time we publish the post (text, photo or multi-photo) to the business's own Facebook Page. Posts are only ever published when the business has scheduled or approved them. Screencast 2.

### pages_read_engagement
We read the connected Page's name, follower count and recent posts with their reactions, comments and shares, to show the business how its content performs on the AdonisAgent dashboard (Social section) and so the business's AI assistant can report on what worked. We also need it to read the Page access token used for publishing. Screencasts 1 and 6.

### pages_manage_metadata
When a business connects its Page, we subscribe our app to the Page's webhooks (leadgen, messages, messaging_postbacks, message_echoes), so new lead ad submissions and customer messages reach the business's AdonisAgent account in real time. Screencasts 3 and 4.

### pages_messaging
Customers message the business's Facebook Page. Those messages appear in the business's AdonisAgent inbox next to their email and SMS conversations, and staff reply from there. Replies are sent by a person on the business's team, inside Meta's standard 24-hour window (or within 7 days with the HUMAN_AGENT tag for replies written by a human). We never send automated messages outside the 24-hour window and never send promotional broadcasts. Screencast 3.

### instagram_basic
We read the Instagram professional account linked to the business's Page (its id, username, follower and media counts) so the business can see which Instagram account is connected, publish to it, and see its follower count on the dashboard. Screencasts 1 and 6.

### instagram_content_publish
Posts the business schedules in AdonisAgent's Content Studio are published to its Instagram professional account at the scheduled time (single images and carousels), alongside the Facebook Page. Only content the business created and scheduled is published. Screencast 2.

### instagram_manage_messages
Instagram Direct messages sent to the business arrive in its AdonisAgent inbox, and staff reply to them from AdonisAgent within Meta's messaging window. The same rules as Messenger apply: human replies, no automated messages outside the window, no broadcasts. Screencast 3.

### instagram_manage_insights
We read the reach and profile views of the business's Instagram account for a chosen period, and the likes and comments on its recent posts, to show on the AdonisAgent dashboard so the business can see how its Instagram is performing. Screencast 6.

### read_insights
We read the connected Page's insights (how many times its content was viewed over a period) to show on the AdonisAgent dashboard next to its Instagram numbers. Screencast 6.

### leads_retrieval
When someone submits a lead form on the business's Facebook or Instagram lead ad, we receive the leadgen webhook and retrieve that lead's answers (name, email, phone and the form's questions) to create the lead in the business's AdonisAgent lead pipeline, so staff can follow up quickly. Leads are stored only in that business's own account. Screencast 4.

### pages_manage_ads
Ads created in AdonisAgent run as the business's own Facebook Page. We use pages_manage_ads to create the ad creative on behalf of the Page and, for lead generation campaigns, to create the instant lead form on the Page that the ad uses. Screencast 5.

### ads_management
AdonisAgent includes an ads manager: a business builds a campaign (objective, location and interest targeting, age range, daily budget, schedule, image and copy) and we create the campaign, ad set, creative and ad in the business's OWN ad account, which Meta bills directly. The business can then pause, resume, change the daily budget or archive it from AdonisAgent. Campaigns are only launched when a person on the business's team presses Launch; our AI assistant can draft a campaign but cannot launch or change spend without that person's explicit approval. Screencast 5.

### ads_read
We read performance for the campaigns a business launched from AdonisAgent (spend, impressions, reach, clicks, leads, cost per result) to show on the campaign's page in AdonisAgent, and we read the ad account's name, currency and status so the business can pick the right account. Screencast 5.

### business_management
Businesses connect through Facebook Login for Business and share assets owned by their Business portfolio. We use business_management to read the ad accounts the business shared from its portfolio, so they can choose which one AdonisAgent runs ads from. Screencasts 1 and 5.

## Features (separate requests on the same page)

### Human Agent
Staff at gyms and clinics often answer a customer's question the next day, after a class or appointment. With the HUMAN_AGENT tag a person on the business's team can reply in Messenger or Instagram up to 7 days after the customer's last message. AdonisAgent only applies the tag to replies typed by a person in the inbox, never to automated or AI-sent messages. Screencast 3 (show a reply after 24 hours, or explain it in the notes).

### Ads Management Standard Access (optional, later)
Raises the Marketing API rate limits. Meta grants it on usage (API call volume and a low error rate over 15 days), not on review notes; apply once real campaigns are running.

## After approval

1. Switch Railway back to the never-expiring login configuration: `railway variables --set FACEBOOK_LOGIN_CONFIG_ID=3470527093144810` (from `app/`).
2. Reconnect in Settings, then choose the ad account again.
3. Switch the app to Live mode (top bar toggle).
