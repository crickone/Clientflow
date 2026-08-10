# IMAP/SMTP Email Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Let a tenant connect a generic IMAP/SMTP mailbox (cPanel / Hosting Ireland / Fastmail / etc.) for a full 2-way inbox — read + reply inside ClientFlow — exactly like the existing Gmail integration, but username/password auth instead of OAuth.

**Architecture:** Parallel the Gmail integration. Credentials live in a new control-plane table `imap_connections` (password AES-encrypted, one row per tenant). Sending goes through `nodemailer` (SMTP); reading through `imapflow` + `mailparser` (IMAP), writing into the SAME per-tenant `email_messages` table the Gmail sync uses — so ALL the existing read helpers (`listEmailThreads`, `listThreadMessages`, `markThreadRead`, `listClientThreadMessages`, `getEmailMessage`), the `EmailInbox` UI, and the reply/refresh actions are reused unchanged. `email.ts`'s provider layer gains an `"imap"` option.

**Tech Stack:** Next.js 14 App Router, better-sqlite3 + Drizzle, `imapflow` (IMAP), `nodemailer` (SMTP), `mailparser` (MIME parse) — all pure-JS. AES-256-GCM via existing `@/lib/google/tokenCrypto`.

## Global Constraints

- **Credentials encrypted at rest.** The mailbox password is stored via `encryptToken()` (`@/lib/google/tokenCrypto`, key `EMAIL_TOKEN_SECRET`) and NEVER returned to the browser. No action or query returns the password (or its ciphertext) to the client.
- **Server-action security (the account-takeover lesson).** Every export of a `"use server"` file is a public endpoint. All IMAP actions call `requireAdmin()` (connect/disconnect/test) or `requireUser()` (sync/reply) AND derive `tenantId` server-side via `getCurrentMembership()`. NEVER accept a caller-supplied tenantId. Any non-action helper (send/sync/CRUD/crypto) lives in a `server-only` lib (`@/lib/imapEmail.ts`), NOT in a `"use server"` file.
- **Reuse `email_messages` verbatim** (no schema change). Store the RFC `Message-ID` header in `gmail_message_id` (UNIQUE → dedupe key) and a synthesized thread key in `gmail_thread_id`. Reuse `listEmailThreads`/`listThreadMessages`/`markThreadRead`/`listClientThreadMessages`/`getEmailMessage`/`EmailMessageRow`/`mapRow` from `@/lib/gmail` unchanged.
- **Never throw from send/sync.** Return `{ok:true; ...} | {ok:false; error:string}` (match `email.ts`/`gmail.ts`).
- **Provider precedence:** `getEmailProvider()` → `gmail` > `imap` > `resend` > `none`. A tenant connects one; if both Gmail and IMAP exist, Gmail wins.
- **Tenant-DB correctness.** `email_messages`/`clients` are per-tenant. Sync/insert must target the RIGHT tenant DB. Reads via the ambient `db` proxy are correct in request scope; for writes from a code path that may run outside the request's tenant (background/explicit-tenant), use `getTenantDbById(tenantId)`.
- **No leaked connections.** Every `imapflow` client is closed (`logout()`/`close()`) in a `finally`. Nodemailer transports are not pooled per-send (create, send, done) OR closed after use.
- **TLS defaults:** IMAP secure=true port 993, SMTP secure=true port 465. Support STARTTLS (`secure:false`) for 143/587 via the stored `*_secure` flags. Do NOT disable cert validation.
- **Deps are pure-JS.** Add `imapflow`, `nodemailer`, `mailparser` (+ `@types/nodemailer`) to `package.json`. Verify `next build` (standalone) traces them; only add to `serverComponentsExternalPackages`/Dockerfile COPY if a runtime "Cannot find module" appears (Task 6 verifies).

---

## Task 1: Deps + `imap_connections` control table + connection CRUD lib

**Files:**
- Modify: `app/package.json` (add deps)
- Modify: `app/src/lib/db/schema.ts` (add `imapConnections` Drizzle table, next to `gmailConnections` ~line 592)
- Modify: `app/src/lib/db/control.ts` (add `CREATE TABLE IF NOT EXISTS imap_connections` inside `ensureControlTables()`, next to the `gmail_connections` block ~line 251)
- Create: `app/src/lib/imapEmail.ts` (connection CRUD)
- Test: `app/src/lib/imapEmail.test.ts`

**Interfaces (Produces):**
```ts
export type ImapConnection = {           // safe shape — NO password
  tenantId: number;
  email: string;
  imapHost: string; imapPort: number; imapSecure: boolean;
  smtpHost: string; smtpPort: number; smtpSecure: boolean;
  username: string;
  fromName: string | null;
  lastSyncAt: number | null;             // epoch ms
};
export function getImapConnection(tenantId: number): ImapConnection | null;
export function isImapConnected(tenantId: number): boolean;
export function saveImapConnection(opts: {
  tenantId: number; email: string;
  imapHost: string; imapPort: number; imapSecure: boolean;
  smtpHost: string; smtpPort: number; smtpSecure: boolean;
  username: string; password: string; fromName?: string; connectedByUserId?: number;
}): void;                                // encrypts password; UPSERT by tenantId
export function deleteImapConnection(tenantId: number): void;
// server-only internal (NOT exported to actions that return to client):
// getImapCredentials(tenantId): { ...ImapConnection, password: string } | null  (decrypts)
```

**Drizzle table** (`schema.ts`) — mirror `gmailConnections`:
```ts
export const imapConnections = sqliteTable("imap_connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().unique().references(() => tenants.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  imapHost: text("imap_host").notNull(),
  imapPort: integer("imap_port").notNull(),
  imapSecure: integer("imap_secure", { mode: "boolean" }).notNull().default(true),
  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull(),
  smtpSecure: integer("smtp_secure", { mode: "boolean" }).notNull().default(true),
  username: text("username").notNull(),
  passwordEnc: text("password_enc").notNull(),
  fromName: text("from_name"),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
  connectedByUserId: integer("connected_by_user_id").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});
```
**DDL** (`control.ts`, inside `ensureControlTables`) — matching `CREATE TABLE IF NOT EXISTS imap_connections (...)` with the same columns/types, `tenant_id INTEGER NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE`, booleans as `INTEGER NOT NULL DEFAULT 1`, `created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)`.

**CRUD** uses `authDb` (control plane), mirrors `getGmailConnection`/`saveGmailConnection`/`deleteGmailConnection` (blueprint §1/§2). `saveImapConnection` encrypts `password` → `passwordEnc` via `encryptToken`. `getImapConnection`/`isImapConnected` select the safe columns only (no `passwordEnc`). `getImapCredentials` (module-internal, `server-only`) selects + decrypts for send/sync/test.

**Test:** scratch tenant (pattern: `src/lib/apiKeys.test.ts`). Assert: save→get returns the safe shape; `passwordEnc` in the raw row is NOT the plaintext; `getImapCredentials` decrypts back to the original; `isImapConnected` true/false; save again updates (UPSERT, still one row); delete removes it. `node --conditions=react-server`; DB tests via `controlSqlite` + `finally` cleanup.

---

## Task 2: SMTP send (nodemailer) + provider wiring in `email.ts`

**Files:**
- Modify: `app/src/lib/imapEmail.ts` (add `smtpSend`, `testImapConnection`, `threadKeyFor`)
- Modify: `app/src/lib/email.ts` (extend `EmailProvider`; `getEmailProvider` + `sendVia` gain `imap`)
- Test: `app/src/lib/imapEmail.test.ts` (extend — pure helpers only)

**Interfaces (Produces):**
```ts
export function threadKeyFor(h: { messageId?: string | null; inReplyTo?: string | null; references?: string[] | string | null }): string | null;
// root of the References chain, else inReplyTo, else messageId (all trimmed); null if none.
export async function smtpSend(tenantId: number, opts: {
  fromName: string; to: string; subject: string; html: string; text?: string;
  replyTo?: string; inReplyTo?: string; references?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
export async function testImapConnection(creds: {
  imapHost: string; imapPort: number; imapSecure: boolean;
  smtpHost: string; smtpPort: number; smtpSecure: boolean;
  username: string; password: string;
}): Promise<{ ok: true } | { ok: false; error: string }>;
```

**`smtpSend`:** decrypt creds via `getImapCredentials(tenantId)` (→ error if none). Build a `nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: smtpSecure, auth: { user: username, pass } })`. `sendMail({ from: '"<fromName>" <email>', to, subject, html, text: text ?? htmlToText(html), replyTo, inReplyTo, references })`. On success nodemailer returns `info.messageId` — use as `id`. **Then INSERT a `direction:"out"` row** into the tenant's `email_messages` via `getTenantDbById(tenantId)`: `gmail_message_id = info.messageId`, `gmail_thread_id = threadKeyFor({messageId: info.messageId, inReplyTo, references}) ?? info.messageId`, `from_email = email`, `to_email = to`, `subject`, `snippet` (first ~140 chars of text), `body_html = html`, `client_id` = looked up from `clients` by `to` (lowercased), `internal_date = now`, `is_read = 1`. Wrap the INSERT in try/catch — a failed bookkeeping insert must NOT fail the send (log + still return ok). Close/verify transport appropriately.

**`testImapConnection`:** open an `ImapFlow` client + `connect()` then `logout()` (in finally) to verify IMAP; verify SMTP with `transport.verify()`. Any throw → `{ok:false, error: friendly message}`. Never leak the connection.

**`email.ts` changes** (blueprint §4, exact):
- Line 65: `export type EmailProvider = "gmail" | "imap" | "resend" | "none";`
- `getEmailProvider()`: after the gmail branch, add `try { if (isImapConnected(getCurrentTenant().id)) return "imap"; } catch {}` before the resend check.
- `sendVia()`: after the gmail `if` block, add:
```ts
if (tenantId !== null && isImapConnected(tenantId)) {
  return smtpSend(tenantId, {
    fromName: sanitizeName(sender.fromName),
    to: Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
    subject: opts.subject, html: opts.html, text: opts.text,
    replyTo: opts.replyTo || sender.replyTo || undefined,
    inReplyTo: opts.gmailThread?.inReplyTo,
    references: opts.gmailThread?.references,
  });
}
```
Import `isImapConnected`, `smtpSend` from `@/lib/imapEmail`. (`sanitizeName`/`htmlToText` already in email.ts — export `htmlToText` if imapEmail needs it, or duplicate a tiny local; prefer importing.)

**Test:** unit-test `threadKeyFor` (references array → root; string refs → first; only inReplyTo; only messageId; all null → null). SMTP/IMAP network paths are covered by review + the live test in Task 6, not unit tests.

---

## Task 3: IMAP inbox sync (`imapflow` + `mailparser`)

**Files:**
- Modify: `app/src/lib/imapEmail.ts` (add `syncImapInbox` + pure parse helpers)
- Test: `app/src/lib/imapEmail.test.ts` (extend — pure parse/normalize helpers)

**Interface (Produces):**
```ts
export async function syncImapInbox(
  tenantId: number, opts?: { days?: number; max?: number },
): Promise<{ ok: true; synced: number } | { ok: false; error: string }>;
```

**Steps** (mirror `syncGmailInbox`, blueprint §1.sync / §10):
1. `days = opts?.days ?? 30`, `max = opts?.max ?? 40`. `getImapCredentials(tenantId)` → error if none.
2. `const tdb = getTenantDbById(tenantId)` (explicit tenant DB — do NOT rely on ambient proxy). Build `clientByEmail: Map<string,number>` from one `SELECT id, email FROM clients` (lowercased keys).
3. `ImapFlow` connect; `getMailboxLock('INBOX')`; search UIDs `since` `days` ago; take the newest `max`. `fetch` those (`envelope`, `source`) → `simpleParser(source)` per message.
4. For each parsed message: `messageId` (parsed.messageId), `from`/`to` (parsed.from/to → first address, lowercased), `subject`, `date` (parsed.date → epoch ms), `bodyHtml = parsed.html || null`, `bodyText = parsed.text || null`, `snippet` = first ~140 chars of text. `direction = "in"` (INBOX). `counterparty = from.email`; `clientId = clientByEmail.get(counterparty) ?? null`. `threadKey = threadKeyFor({messageId, inReplyTo: parsed.inReplyTo, references: parsed.references}) ?? messageId`.
5. Dedupe: one batched `SELECT gmail_message_id FROM email_messages WHERE gmail_message_id IN (messageIds)` → skip existing. INSERT new rows (`gmail_message_id = messageId`, `gmail_thread_id = threadKey`, direction `in`, from/to/subject/snippet/body/client_id/internal_date, `is_read = 0`). A message with no `messageId` is skipped (can't dedupe safely).
6. `UPDATE imap_connections SET last_sync_at = now WHERE tenant_id = ?`. Return `{ok:true, synced: <newCount>}`.
7. `finally`: release lock + `client.logout()`. One bad message never aborts the batch (best-effort per message). Catch outer → `{ok:false, error}`.

**Pure helpers to extract + test:** `normalizeAddress(addr)` (→ `{name, email}` lowercased) and `snippetOf(text, n=140)` and `threadKeyFor` (already). Unit-test these; the imapflow network path is covered by review + Task 6 live test.

---

## Task 4: Server actions (connect / test / disconnect / provider-aware sync)

**Files:**
- Create: `app/src/app/settings/email/imapActions.ts`
- Modify: `app/src/app/communication/actions.ts` (`refreshInboxAction` becomes provider-aware)

**`imapActions.ts`** (`"use server"`; mirror `gmailActions.ts` gating, blueprint §7):
```ts
export type ImapActionResult = { ok: true } | { ok: false; error: string };
export async function testImapConnectionAction(input: ImapFormInput): Promise<ImapActionResult>; // requireAdmin
export async function connectImapAction(input: ImapFormInput): Promise<ImapActionResult>;        // requireAdmin: test → saveImapConnection → revalidate
export async function disconnectImapAction(): Promise<ImapActionResult>;                          // requireAdmin: deleteImapConnection → revalidate
```
`ImapFormInput` = `{ email; password; imapHost; imapPort; imapSecure; smtpHost; smtpPort; smtpSecure; fromName? }` (username defaults to email). Validate with zod (email format, ports 1–65535, non-empty hosts). `tenantId` via a private `tenantId()` helper calling `getCurrentMembership()` — NEVER from input. `connectImapAction`: run `testImapConnection` first; on failure return its error (do not save); on success `saveImapConnection({...input, username: input.email, tenantId, connectedByUserId: me.id})`, `revalidatePath("/settings/email")` + `"/communication"`. `disconnectImapAction`: `deleteImapConnection(tenantId())`, revalidate both. No export takes/returns a password or tenantId from the client.

**`communication/actions.ts` — `refreshInboxAction`** (blueprint §6): make provider-aware:
```ts
const provider = getEmailProvider();
if (provider === "gmail") { const r = await syncGmailInbox(currentTenantId()); ... }
else if (provider === "imap") { const r = await syncImapInbox(currentTenantId()); ... }
else return { ok: true, synced: 0 };
```
`replyEmailAction` already routes through `sendEmail` (→ `sendVia` → imap branch) so replies send over SMTP automatically. **One required change to `replyEmailAction`:** also pass threading so SMTP threads correctly — `sendEmail({ to, subject, html, text, gmailThread: { threadId: msg.gmailThreadId, inReplyTo: msg.gmailMessageId, references: msg.gmailThreadId ?? msg.gmailMessageId } })`. (Harmless for Gmail — `gmailSend` already accepts inReplyTo/references.) After send, the existing post-send re-sync line must also be provider-aware (gmail→syncGmailInbox, imap→syncImapInbox, else skip) — for imap the out-row is already inserted by `smtpSend`, so the re-sync is optional; guard it so it doesn't call syncGmailInbox for an imap tenant.

---

## Task 5: UI — `ImapConnectCard` + Settings/Communication wiring

**Files:**
- Create: `app/src/components/settings/ImapConnectCard.tsx`
- Modify: `app/src/app/settings/email/page.tsx` (render the card; fetch imap connection)
- Modify: `app/src/app/communication/page.tsx` (gate Email tab on gmail OR imap)

**`ImapConnectCard`** (mirror `GmailConnectCard` shape, blueprint §5; client component):
- Props: `{ connection: ImapConnection | null; active: boolean }` (active = provider === "imap").
- Not connected: a form — Email + Password (type=password), and an "Advanced" disclosure with IMAP host/port/secure + SMTP host/port/secure. On email blur, auto-fill hosts to `mail.<domain>` and ports 993/465 secure=true IF still blank. Buttons: **Test connection** (`testImapConnectionAction`) shows ok/error inline; **Connect** (`connectImapAction`) on success reloads to show connected state. Never render the password back.
- Connected: show `connection.email` + "Active sender" badge when `active`; a **Disconnect** button (`disconnectImapAction`). Note it's send + 2-way inbox.
- Use `Card`/`Input`/`Label`/`Button` + `toast`, `useTransition`. Copy: mention cPanel "Connect Devices" is where to find host/password.

**`settings/email/page.tsx`:** add `const imap = getImapConnection(tenantId);` and render `<ImapConnectCard connection={imap} active={provider === "imap"} />` below the Resend form. (Blueprint §5 shows the page's existing fetches.)

**`communication/page.tsx`** (blueprint §6): replace the `gmail`-only gate:
```ts
const gmail = getGmailConnection(tenantId);
const imap = getImapConnection(tenantId);
const emailConn = gmail ?? imap;                 // connectedEmail source
const threads = emailConn ? listEmailThreads() : [];
```
Render `<EmailInbox threads={threads} connectedEmail={emailConn.email} />` when `emailConn`. `EmailInbox` + `loadEmailThreadAction`/`replyEmailAction`/`refreshInboxAction` are reused unchanged (refresh is now provider-aware from Task 4).

---

## Task 6: Build/deps verification + docs + deploy prep

**Files:**
- Possibly modify: `app/next.config.mjs` (`serverComponentsExternalPackages`) and/or `app/Dockerfile` (COPY) — ONLY if verification shows tracing missed a module.
- Modify: `CLAUDE.md` / memory note (document the connector).

**Steps:**
1. `npm run typecheck`, `npm test`, `npx next build` — all pass.
2. After build, check `.next/standalone/node_modules` contains `imapflow`, `nodemailer`, `mailparser` (and their deps). If any missing → add to `serverComponentsExternalPackages` and add explicit `COPY --from=builder /app/node_modules/<pkg>` lines in the Dockerfile runner stage (mirror the sharp/@img lines), then rebuild.
3. Confirm `imapflow`/`nodemailer` do not pull native bindings that need the same treatment (they're pure JS; verify no `.node` files required at runtime).
4. Final whole-branch review (opus) — focus: password never leaves the server or appears in any action return/log; admin/tenant gating on every action (no leaked-endpoint takeover); imapflow connections closed in finally (no socket leak); provider precedence correct; SMTP threading headers; TLS not disabled; never-throws.

**Manual verification (after deploy, by the operator):** connect a real Hosting Ireland mailbox, Test connection, send a test to yourself, Refresh the inbox, reply to a message — confirm round-trip.
