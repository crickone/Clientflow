# Client domains

How a client's own web address (www.theirbusiness.ie) reaches their site on
AdonisAgent, for any number of clients.

## How it works

```
visitor -> www.client.ie (CNAME) -> sites.adonisagent.ie (Cloudflare)
        -> Worker infra/cloudflare/sites-proxy.js
        -> Railway service, with the domain + a shared secret
        -> middleware trusts the domain (lib/cms/proxyHost.ts)
        -> /site/_host/... resolves the site from site_domains (verified rows only)
```

- **Cloudflare for SaaS** holds one "custom hostname" per client domain and
  issues and renews its HTTPS certificate. The app registers each domain when
  it is added under CMS > site > Domains (`lib/cms/customHostnames.ts`).
- **Railway** never sees client domains. Only the Railway service's own name
  is used, so the Railway plan's custom-domain cap does not apply.
- **No redeploy per client.** Routing reads the verified domain from the
  database; `CMS_SITE_HOSTS` is only for the platform's own sites.
- **Ownership** is still proved by the client: the `_adonisagent-verify` TXT
  record, before the site will serve on the domain.

## One-time setup (done once for the whole platform)

### 1. Move adonisagent.ie's DNS to Cloudflare

1. Create a Cloudflare account and **Add a site**: `adonisagent.ie`, Free plan.
2. Cloudflare scans the existing records. **Check every record against the
   Web Hosting Ireland DNS panel before switching**; the scan misses some.
   As of 2026-10-09 the zone holds at least:

   | Name | Type | Value | Proxy |
   | --- | --- | --- | --- |
   | adonisagent.ie | MX | 0 mail.adonisagent.ie | n/a |
   | adonisagent.ie | TXT | v=spf1 +a +mx +ip4:91.210.235.65 ~all | n/a |
   | mail | A | 91.210.235.65 | DNS only |
   | webmail, ftp | A | 91.210.235.65 | DNS only |
   | default._domainkey | TXT | (the DKIM key, copy it whole) | n/a |
   | _dmarc | TXT | v=DMARC1; p=none; | n/a |
   | www | CNAME | p1i2y34c.up.railway.app | **DNS only** |
   | app | CNAME | 1th3btl9.up.railway.app | **DNS only** |
   | _railway-verify.www | TXT | railway-verify=5344d9... (copy whole) | n/a |
   | _railway-verify.app | TXT | railway-verify=3e4d8a... (copy whole) | n/a |
   | mg | TXT | v=spf1 include:mailgun.org ~all | n/a |
   | s1._domainkey.mg | TXT | (Mailgun DKIM, copy whole) | n/a |
   | email.mg | CNAME | eu.mailgun.org | DNS only |

   `www` and `app` must stay **DNS only** (grey cloud): Railway issues their
   certificates itself.
3. Bare `adonisagent.ie`: replace the A record with a proxied record and add a
   Redirect Rule `adonisagent.ie/*` -> `https://www.adonisagent.ie/$1` (301).
   This also fixes https on the bare domain, which fails today.
4. At Web Hosting Ireland, change the domain's nameservers to the two
   Cloudflare gives you. Email and the sites keep working throughout as long
   as every record above was copied.

### 2. Turn on Cloudflare for SaaS

1. In the adonisagent.ie zone: **SSL/TLS > Custom Hostnames**, enable it (it
   asks for a payment method; the first 100 hostnames are included).
2. Add a DNS record `sites` (A, `192.0.2.1`, **Proxied**). The address is a
   placeholder: the Worker answers every request before it would be used.
3. Set **Fallback Origin** to `sites.adonisagent.ie`. Wait for it to show Active.

### 3. The Worker

1. **Workers & Pages > Create > Worker**, name it `adonis-sites`, paste
   `infra/cloudflare/sites-proxy.js`, deploy.
2. **Settings > Variables**: `ORIGIN` =
   `https://clientflow-production-ee94.up.railway.app`, and `PROXY_KEY` (type
   Secret) = the same value as `SITES_PROXY_SECRET` on Railway.
3. **Settings > Domains & Routes > Add route**: `*/*` on zone `adonisagent.ie`.
   (The Worker passes the platform's own names straight through.)

### 4. Tell the app

On Railway, set:

- `SITES_PROXY_SECRET`: a long random string, shared with the Worker.
- `CLOUDFLARE_ZONE_ID`: the zone's ID (Overview page, right column).
- `CLOUDFLARE_API_TOKEN`: My Profile > API Tokens > Create, custom token with
  **Zone > SSL and Certificates > Edit** on zone adonisagent.ie only.

The Domains page stops showing "Client domains are not switched on" once the
last two are set.

## Each new client

1. CMS > the client's site > **Domains** > add `www.theirdomain.ie`, ticked as
   the main address. Add the bare domain too if they want it listed.
2. The client (or whoever holds their DNS) adds the two records the page shows:
   the `_adonisagent-verify` TXT, and `www` CNAME `sites.adonisagent.ie`.
   **Email (MX) records are not touched.**
3. Bare domain: forward it to `https://www.theirdomain.ie` at the registrar.
4. Press **Verify**, then **Check again** until all three steps show Done.
5. Turn the old site off only after `https://www.theirdomain.ie` loads the new one.
