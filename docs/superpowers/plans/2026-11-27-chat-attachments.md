# Attach files in every one-to-one chat: Implementation Plan

> For agentic workers: implement task by task. Each task ends with typecheck + its tests passing and one commit.

**Goal:** staff can attach files (paperclip, drag in, paste) to every one-to-one message box, and the file is actually delivered on that channel and shown in the thread.

**User decisions (2026-11-27):** all one-to-one chats (Inbox WhatsApp/Messenger/Instagram + email replies; lead page WhatsApp, email, team note; client page WhatsApp, email). NOT broadcasts, NOT Google review replies, NOT the Adonis chat (it already has a paperclip). Files from the computer only (no library picker).

**Architecture:** the browser uploads each file first to `POST /api/messages/attachments`, which validates it, stores it in the business's private inbox-media folder (the same store as inbound media, `lib/inbox/media.ts saveMediaFile`) and returns a signed, expiring attachment token plus a preview record. The composer then calls its existing server action with `attachments: string[]` (tokens). The action verifies the tokens (tenant-bound, unexpired), reads the bytes and hands `OutgoingFile[]` to the channel sender. Each channel gets media sending: Whapi (image/video/audio/document), Meta Send API (multipart attachment upload), and email attachments on all four senders. Sent files are stored on the message rows' existing `media` JSON column (`MessageMedia[]`), so the thread renders them exactly like inbound media.

**Tech:** Next.js 15 App Router, TypeScript, SQLite/drizzle, better-sqlite3. Tests are plain `tsx` scripts run with `npm test -- <file>` (see any `*.test.ts`).

## Global constraints (every task)
- Limits: max 5 files per message; max **16 MB per file**; email total max **20 MB**.
- Allowed types only (outgoing allowlist): image/jpeg, image/png, image/webp, image/gif; application/pdf, msword, docx, ms-excel, xlsx, ms-powerpoint, pptx, text/plain, text/csv; video/mp4, video/quicktime; audio/mpeg, audio/mp4 (m4a), audio/ogg. Everything else refused with a plain reason, e.g. "That kind of file can't be sent. Send a photo, PDF, Word, Excel, PowerPoint, video or audio file." SVG and executables are never allowed.
- Never trust the browser's mime alone: sniff magic bytes for images/PDF/zip-based Office/mp4 where cheap; reject a mismatch.
- Tenant isolation: tokens carry the tenant id and are refused in another tenant. Files live in `data/tenants/<slug>/inbox-media/` (mode 0600), served only via `/api/inbox/media/[file]` to signed-in staff of that tenant.
- Copy: plain, short, sentence case. NO EMOJIS anywhere (code, comments, UI, commits).
- Do not change behaviour of text-only sends: every existing caller keeps working unchanged (attachments are optional everywhere).
- Writes: never `git add -A`; add files by path. Commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run from `app/`: `npm run typecheck` must be clean; run the tests you touch with `npm test -- <path>`.

---

### Task 1: Outgoing file rules, attachment tokens, upload route
**Files:** create `src/lib/attachments/outgoingModel.ts` (pure) + test; create `src/lib/attachments/token.ts` (server) + test; create `src/app/api/messages/attachments/route.ts` + `route.test.ts`; create `src/lib/attachments/load.ts` (server).

**Produces:**
- `OUTGOING_LIMITS = { maxFiles: 5, maxFileBytes: 16*1024*1024, maxEmailBytes: 20*1024*1024 }`
- `checkOutgoingFile({ name, size, mime }): { ok: true; kind: MediaKind; mime: string } | { ok: false; error: string }` (uses `classifyMime` from `lib/inbox/mediaModel.ts` for kind/ext; applies the allowlist above).
- `sniffMatches(mime: string, head: Uint8Array): boolean` (jpeg FF D8 FF, png 89 50 4E 47, gif "GIF8", webp "RIFF....WEBP", pdf "%PDF", docx/xlsx/pptx "PK\x03\x04", doc/xls/ppt D0 CF 11 E0, mp4/mov "ftyp" at offset 4, mp3 "ID3" or FF Fx, ogg "OggS", m4a "ftyp"; text/plain + csv: no NUL byte in the first 1 KB).
- `checkOutgoingSet(files, channel: "whatsapp" | "messenger" | "instagram" | "email" | "note")`: count and email-total rules.
- `signAttachment(tenantId, media: MessageMedia, ttlMs = 2h): string` and `verifyAttachment(token, tenantId): MessageMedia | null` (HMAC-SHA256, secret `process.env.SOCIAL_TOKEN_SECRET || process.env.EMAIL_TOKEN_SECRET`, same style as `lib/social/renderToken.ts`; base64url payload `{t, m, x}`; constant-time compare).
- `loadAttachments(tokens: string[] | undefined): OutgoingFile[]` in `load.ts`, where `OutgoingFile = { media: MessageMedia; bytes: Buffer }`. Verifies every token for the current tenant (`getCurrentTenant()`), reads bytes via `inboxMediaPath`, throws `Error("That attachment has expired. Attach it again.")` on any bad token. Empty/undefined -> [].
- Route `POST /api/messages/attachments`: `guard("user")` like other staff routes; multipart form field `file`; reject > 16 MB before buffering where possible (content-length), then check type, sniff, save with `saveMediaFile(tenant.slug, buf, mime, name)`, respond `{ ok: true, token, media: { kind, file, mime, name, size } }` or `{ ok: false, error }` with 400/413. Also add an app-level route body size note: route handlers read `req.formData()`, no server-action body limit applies.

**Tests:** model rules (each allowed type ok, svg/exe/zip refused, 16 MB+1 refused, 6 files refused, email total over 20 MB refused), sniff table, token round trip, wrong tenant -> null, expired -> null, tampered -> null; route: allowed PDF upload returns token and writes the file; SVG -> 400; mismatched bytes (png mime, pdf bytes) -> 400; unauthenticated -> 401/redirect as the guard does elsewhere (copy the pattern from an existing route test that runs a route in a scratch tenant).

### Task 2: WhatsApp and Messenger/Instagram media sending
**Files:** modify `src/lib/whatsapp/whapi.ts`, `src/lib/whatsapp/types.ts`, `src/lib/whatsapp/send.ts`, `src/lib/social/dm.ts`, `src/lib/messaging/reply.ts`; tests next to them.

**Consumes:** `OutgoingFile` from Task 1.
**Produces:**
- `WhatsAppBridge.sendMedia?(toPhone, file: { kind: MediaKind; mime: string; name?: string; bytes: Buffer; caption?: string }): Promise<{ providerMessageId: string }>`. Whapi impl: POST `${base}/messages/image|video|audio|document` (kind file -> document) with JSON `{ to, media: "data:<mime>;name=<encoded name>;base64,<b64>", caption?, filename? (document only) }`. Same error handling/id parsing as `sendText` (extract a shared response parser). Pure payload builder `whapiMediaPayload(...)` exported for tests.
- `sendWhatsApp(input)` gains `attachments?: OutgoingFile[]`; text becomes optional when attachments are present (empty text + no files still throws "Message is empty."). Order: text first (if any), then each file. Each file stores its own message row: `content: ""`, `media: [file.media]`, `providerMessageId`, status sent. If a file fails, store the row with `status: "failed"`, `error: <reason>` (check `addMessage` / `addClientMessage` accept media/status/error; extend them if needed) and continue with the rest; throw only if NOTHING was sent. Return `{ messageId, providerMessageId, failed: string[] }` (keep old fields).
- `sendDm(input)` gains `attachments?: OutgoingFile[]`: multipart POST to `/{pageId}/messages` with fields `recipient`, `messaging_type` (+`tag` as today), `message={"attachment":{"type":"image|video|audio|file","payload":{"is_reusable":false}}}` and `filedata` (Blob with the file name + mime). Same window/token/error rules as text. Same per-file row storage and partial-failure rule.
- `sendReply` passes `attachments` through to whichever channel.

**Tests:** whapi payload builder per kind (document gets filename), fake bridge: text+2 files -> 3 rows with media on the file rows; one failing file -> failed row with error, others sent; no text + no files -> throws. Meta: a pure `dmAttachmentForm(...)` builder returning the FormData fields; assert type mapping and that the 7-day/human-agent rules still apply with attachments.

### Task 3: Email attachments
**Files:** modify `src/lib/email.ts` (`SendOpts.attachments?: { filename: string; mime: string; content: Buffer }[]`), `src/lib/gmail.ts` (`buildMime` -> multipart/mixed when attachments; base64 parts wrapped at 76 chars; filename RFC 2231/encoded-word safe), `src/lib/imapEmail.ts` (nodemailer `attachments`), `src/lib/mailgunRoute.ts` (form field `attachment` per file), Resend path in `email.ts` (`attachments: [{ filename, content }]`). Add a nullable `media` TEXT column (JSON `MessageMedia[]`) to `client_emails` and `email_messages` (schema.ts + tenant.ts `addColumn`, same way `lead_messages.media` was added).
- `lib/clientEmail.ts` send path and the lead email send (`sendLeadEmailAction` -> lead_messages row) accept `attachments?: OutgoingFile[]`, pass them to `sendEmail`, and store `media` on the stored row.
- The Inbox email reply (`replyEmailAction` path) does the same and stores `media` on its `email_messages` row.

**Tests:** `buildMime` with 0 attachments is byte-identical to today (golden), with 2 attachments is multipart/mixed with the html part first and correct headers; a non-ASCII filename is encoded; Mailgun form has one `attachment` per file; total over 20 MB refused before any send.

### Task 4: Actions + composer UI
**Files:** modify the actions `src/app/communication/actions.ts` (`sendInboxMessageAction`, `replyEmailAction`), `src/app/leads/actions.ts` (`sendLeadWhatsAppAction`, `sendLeadEmailAction`, `addLeadNoteAction`), `src/app/clients/actions.ts` (`sendClientWhatsAppAction`), the client email action used by `ClientEmailPanel`; each takes `attachments?: string[]` and calls `loadAttachments`. A team note stores `media` on its `note` row (no sending).
- Create `src/components/messaging/useAttachments.ts` (hook: list of `{ id, name, size, kind, status: "uploading" | "ready" | "error", progress, token?, error? }`, `add(files)`, `remove(id)`, `clear()`, `tokens`, `busy`; uploads each file with XMLHttpRequest to `/api/messages/attachments` for progress; checks type/size/count client-side first using `checkOutgoingFile`/`OUTGOING_LIMITS` from Task 1 so the refusal is instant) and `src/components/messaging/AttachmentTray.tsx` (paperclip icon button from lucide `Paperclip`, hidden `<input type="file" multiple accept=...>`, chips with file name, size, a progress bar while uploading, an error line, an X to remove; button `aria-label="Attach a file"`). Drag-and-drop onto the composer and paste of images (clipboard files) both call `add`.
- Wire it into: `components/messaging/ConversationThread.tsx` composer (used by Inbox and client WhatsApp), `components/leads/LeadDetail.tsx` main composer (WhatsApp / Email / Note modes; NOT the AI-draft editor or the "Log a reply" box), `components/clients/ClientEmailPanel.tsx`, `components/inbox/EmailReader.tsx`. Send is enabled when there is text OR at least one ready file, and disabled while any file is still uploading. After a successful send the tray clears; on failure the files stay.
- Outbound media renders: ConversationThread already renders `m.media` via `MessageBody`; make sure the lead page timeline, client email list and inbox email reader show sent files (image thumbnail or a file row linking to `/api/inbox/media/<file>`), reusing `MessageBody` where it fits.
- Padding rule: controls never cramped (icon buttons at least 36px square; chips 8px 12px padding).

**Tests:** a pure test for any helper you add (e.g. the client-side check); action tests where an existing action test file exists. Then a browser check is done by the controller.
