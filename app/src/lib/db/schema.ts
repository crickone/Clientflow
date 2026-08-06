import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const clients = sqliteTable("clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone").notNull(),
  dateOfBirth: text("date_of_birth"),
  address: text("address"),
  medicalNotes: text("medical_notes"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  gdprConsent: integer("gdpr_consent", { mode: "boolean" }).default(false),
  gdprConsentDate: integer("gdpr_consent_date", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Synced Gmail messages (both inbound + outbound) for the Communication inbox
// when a tenant connects Gmail. Deduped on gmail_message_id. Linked to a client
// by matching the counterparty address when possible.
export const emailMessages = sqliteTable("email_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gmailMessageId: text("gmail_message_id").notNull().unique(),
  gmailThreadId: text("gmail_thread_id"),
  direction: text("direction", { enum: ["in", "out"] }).notNull(),
  fromEmail: text("from_email"),
  fromName: text("from_name"),
  toEmail: text("to_email"),
  subject: text("subject"),
  snippet: text("snippet"),
  bodyHtml: text("body_html"),
  bodyText: text("body_text"),
  clientId: integer("client_id"),
  internalDate: integer("internal_date", { mode: "timestamp_ms" }),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// General-purpose calendar: meetings and any events not tied to the booking
// system. Independent of appointments/timetable.
export const calendarEvents = sqliteTable("calendar_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  date: text("date").notNull(), // YYYY-MM-DD
  startTime: text("start_time"), // HH:mm (null when all-day)
  endTime: text("end_time"),
  allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
  location: text("location"),
  color: text("color"), // hex accent for the pill
  createdByUserId: integer("created_by_user_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

// One-to-one emails sent to a client from the app. Kept as a sent log per client
// so staff can see what was sent, and to feed the Communication Email tab.
export const clientEmails = sqliteTable("client_emails", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status", { enum: ["sent", "failed"] }).notNull().default("sent"),
  providerId: text("provider_id"),
  error: text("error"),
  sentByUserId: integer("sent_by_user_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const therapies = sqliteTable("therapies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  colourHex: text("colour_hex").notNull(),
  defaultDurationMinutes: integer("default_duration_minutes").notNull(),
  defaultPriceEur: real("default_price_eur").notNull(),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  // Venue-neutral: 1 = a 1:1 service (clinic default); >1 = a class with
  // multiple spots (gym). Behaviour unchanged until class rosters land later.
  capacity: integer("capacity").notNull().default(1),
});

export const appointments = sqliteTable("appointments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // ISO date YYYY-MM-DD
  startTime: text("start_time").notNull(), // HH:mm
  endTime: text("end_time").notNull(), // HH:mm
  status: text("status", {
    enum: ["scheduled", "confirmed", "completed", "cancelled", "no_show"],
  })
    .notNull()
    .default("scheduled"),
  therapyIds: text("therapy_ids").notNull().default("[]"), // JSON array
  totalPriceEur: real("total_price_eur").notNull().default(0),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  appointmentId: integer("appointment_id")
    .notNull()
    .references(() => appointments.id, { onDelete: "cascade" }),
  clientId: integer("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  therapyId: integer("therapy_id")
    .notNull()
    .references(() => therapies.id),
  date: text("date").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  therapistNotes: text("therapist_notes"),
  outcomeRating: integer("outcome_rating"),
  packageId: integer("package_id").references(() => packages.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const packages = sqliteTable("packages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  therapyId: integer("therapy_id")
    .notNull()
    .references(() => therapies.id),
  packageName: text("package_name").notNull(),
  totalSessions: integer("total_sessions").notNull(),
  sessionsUsed: integer("sessions_used").notNull().default(0),
  pricePaidEur: real("price_paid_eur").notNull(),
  purchaseDate: text("purchase_date").notNull(),
  expiryDate: text("expiry_date").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  notes: text("notes"),
  // Venue-neutral: only prepaid_sessions is exercised today; recurring fields
  // exist for gym memberships (sub-project 5).
  planType: text("plan_type", {
    enum: ["prepaid_sessions", "recurring_membership", "drop_in"],
  })
    .notNull()
    .default("prepaid_sessions"),
  billingIntervalMonths: integer("billing_interval_months"),
  recurringPriceEur: real("recurring_price_eur"),
});

export const packageTemplates = sqliteTable("package_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  therapyId: integer("therapy_id")
    .notNull()
    .references(() => therapies.id),
  totalSessions: integer("total_sessions").notNull(),
  priceEur: real("price_eur").notNull(),
  validityMonths: integer("validity_months").notNull().default(12),
  notes: text("notes"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  // Venue-neutral: mirrors packages.plan_type. Only prepaid_sessions is used
  // today; recurring fields are for gym memberships (sub-project 5).
  planType: text("plan_type", {
    enum: ["prepaid_sessions", "recurring_membership", "drop_in"],
  })
    .notNull()
    .default("prepaid_sessions"),
  billingIntervalMonths: integer("billing_interval_months"),
  recurringPriceEur: real("recurring_price_eur"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const giftVouchers = sqliteTable("gift_vouchers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  purchaserName: text("purchaser_name").notNull(),
  purchaserEmail: text("purchaser_email"),
  purchaserClientId: integer("purchaser_client_id").references(() => clients.id),
  recipientName: text("recipient_name"),
  recipientClientId: integer("recipient_client_id").references(() => clients.id),
  therapyId: integer("therapy_id").references(() => therapies.id),
  valueEur: real("value_eur").notNull(),
  balanceEur: real("balance_eur").notNull().default(0),
  isRedeemed: integer("is_redeemed", { mode: "boolean" })
    .notNull()
    .default(false),
  redeemedByClientId: integer("redeemed_by_client_id").references(
    () => clients.id,
  ),
  redeemedAt: integer("redeemed_at", { mode: "timestamp_ms" }),
  purchaseDate: text("purchase_date").notNull(),
  expiryDate: text("expiry_date").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const payments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  packageId: integer("package_id").references(() => packages.id),
  voucherId: integer("voucher_id").references(() => giftVouchers.id),
  amountEur: real("amount_eur").notNull(),
  paymentMethod: text("payment_method", {
    enum: ["cash", "card", "voucher", "bank_transfer", "package"],
  }).notNull(),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const blockOuts = sqliteTable("block_outs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: ["one_off", "recurring"] }).notNull(),
  date: text("date"), // YYYY-MM-DD for one_off
  endDate: text("end_date"), // optional multi-day one_off range end
  dayOfWeek: integer("day_of_week"), // legacy single-day; superseded by daysOfWeek
  daysOfWeek: text("days_of_week"), // comma-separated 0=Sun..6=Sat for recurring
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  reason: text("reason").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const leads = sqliteTable("leads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull().default("manual"),
  sourceLeadId: text("source_lead_id"),
  campaign: text("campaign"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email"),
  phone: text("phone"),
  therapyInterest: text("therapy_interest"),
  notes: text("notes"),
  rawPayload: text("raw_payload"),
  status: text("status", {
    enum: ["new", "contacted", "replied", "booked", "lost"],
  })
    .notNull()
    .default("new"),
  // Single, mutually-exclusive customer-journey stage (the segmentation funnel).
  // Forward-only auto-advance via lib/pipeline/stage.ts; supersedes `status`.
  pipelineStage: text("pipeline_stage", {
    enum: [
      "new_lead",
      "hot_lead",
      "consultation_booked",
      "no_show",
      "attended",
      "sale",
      "repeat_customer",
      "lapsed",
      "lost",
    ],
  })
    .notNull()
    .default("new_lead"),
  clientId: integer("client_id").references(() => clients.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * AI-triage columns shared by lead_messages and client_messages. Populated on
 * inbound rows by the triage pipeline; all null until a message is triaged.
 * Factory (not a shared object) so each table gets its own column builders.
 */
const triageColumns = () => ({
  aiCategory: text("ai_category", {
    enum: [
      "new_lead",
      "booking",
      "existing_client",
      "faq",
      "sensitive",
      "spam",
      "other",
    ],
  }),
  aiPriority: text("ai_priority", { enum: ["high", "normal", "low"] }),
  aiSummary: text("ai_summary"),
  aiConfidence: real("ai_confidence"),
  aiSensitive: integer("ai_sensitive", { mode: "boolean" }),
  aiTriagedAt: integer("ai_triaged_at", { mode: "timestamp_ms" }),
  autoReplyStatus: text("auto_reply_status", {
    enum: ["none", "drafted", "auto_sent", "held", "approved"],
  })
    .notNull()
    .default("none"),
  aiSuggestedReply: text("ai_suggested_reply"),
});

export const leadMessages = sqliteTable("lead_messages", {
  ...triageColumns(),
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  direction: text("direction", {
    enum: ["outbound", "inbound", "note"],
  }).notNull(),
  channel: text("channel", {
    enum: ["email", "sms", "whatsapp", "call", "manual", "system"],
  }),
  content: text("content").notNull(),
  aiGenerated: integer("ai_generated", { mode: "boolean" })
    .notNull()
    .default(false),
  // Set when sent via a real transport (e.g. WhatsApp bridge). Null = log-only.
  providerMessageId: text("provider_message_id"),
  status: text("status", {
    enum: ["queued", "sent", "delivered", "read", "failed"],
  }),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/** Conversation messages for clients/members (mirrors lead_messages). */
export const clientMessages = sqliteTable("client_messages", {
  ...triageColumns(),
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  direction: text("direction", {
    enum: ["outbound", "inbound", "note"],
  }).notNull(),
  channel: text("channel", {
    enum: ["email", "sms", "whatsapp", "call", "manual", "system"],
  }),
  content: text("content").notNull(),
  aiGenerated: integer("ai_generated", { mode: "boolean" })
    .notNull()
    .default(false),
  providerMessageId: text("provider_message_id"),
  status: text("status", {
    enum: ["queued", "sent", "delivered", "read", "failed"],
  }),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/** AI inbox: tag vocabulary — controlled core tags plus AI-suggested tags. */
export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  slug: text("slug").notNull().unique(),
  color: text("color"),
  isCore: integer("is_core", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/** AI inbox: conversation↔tag links, polymorphic over lead/client conversations. */
export const conversationTags = sqliteTable("conversation_tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerType: text("owner_type", { enum: ["lead", "client"] }).notNull(),
  ownerId: integer("owner_id").notNull(),
  tagId: integer("tag_id")
    .notNull()
    .references(() => tags.id, { onDelete: "cascade" }),
  addedBy: text("added_by", { enum: ["ai", "user"] })
    .notNull()
    .default("ai"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * Control-plane: the registry of businesses (tenants). Lives in control.db, not
 * a tenant DB. Each tenant's business data lives in its own SQLite file at
 * `dbFile`.
 */
export const tenants = sqliteTable("tenants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  dbFile: text("db_file").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "staff"] }).notNull().default("staff"),
  // Control-plane: which business this user belongs to, and whether they're a
  // platform-level super-admin (manages tenants). Nullable for migration safety.
  tenantId: integer("tenant_id").references(() => tenants.id),
  isPlatformAdmin: integer("is_platform_admin", { mode: "boolean" })
    .notNull()
    .default(false),
  mustChangePassword: integer("must_change_password", { mode: "boolean" })
    .notNull()
    .default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Multi-account identity: which tenant this session is currently "in". NULL =
  // a multi-clinic user who hasn't picked yet (→ /select-account). Resolved per
  // request by getCurrentTenant() / getCurrentMembership().
  activeTenantId: integer("active_tenant_id").references(() => tenants.id),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// ── Client app auth (control plane) ───────────────────────────────────────────
// Clients log into the mobile app (`/app`). Credentials live in the control
// plane keyed by email → (tenant, client row in that tenant's DB), so a client
// can sign in without knowing their gym's hostname.
export const clientCredentials = sqliteTable("client_credentials", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  clientId: integer("client_id").notNull(), // logical ref into tenant DB's clients table
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export const clientSessions = sqliteTable("client_sessions", {
  id: text("id").primaryKey(),
  credentialId: integer("credential_id")
    .notNull()
    .references(() => clientCredentials.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull(),
  clientId: integer("client_id").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

// Client-app password resets + first-password invites. A single-use, expiring
// token bound to a client_credentials row. Powers both the migration bulk-invite
// ("set your password") and the client forgot-password flow. Mirrors the shape
// of user_invites; lives in the control plane.
export const clientPasswordResets = sqliteTable("client_password_resets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  credentialId: integer("credential_id")
    .notNull()
    .references(() => clientCredentials.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type ClientPasswordReset = typeof clientPasswordResets.$inferSelect;
export type NewClientPasswordReset = typeof clientPasswordResets.$inferInsert;

// Staff invitations: a pending "set your password" link emailed to a new team
// member. The identity + membership are created up-front (so they show in the
// roster as pending); accepting the invite just sets their password + activates.
export const userInvites = sqliteTable("user_invites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["admin", "staff"] }).notNull().default("staff"),
  invitedByUserId: integer("invited_by_user_id").references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// A tenant's connected Google/Gmail account (OAuth). One per tenant. Tokens are
// stored ENCRYPTED (see lib/google/tokenCrypto). Used to send + read email so a
// business can use their own Gmail as the comms address.
export const gmailConnections = sqliteTable("gmail_connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id")
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessToken: text("access_token"),
  tokenExpiry: integer("token_expiry", { mode: "timestamp_ms" }),
  scope: text("scope"),
  historyId: text("history_id"),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
  connectedByUserId: integer("connected_by_user_id").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Control-plane: per-tenant API keys for server-to-server integrations
// (Zapier/Make/Facebook lead-gen → the inbound-leads webhook). Only the sha256
// HASH of a key is stored (key_hash); the raw key is shown to the admin once at
// creation. key_prefix is the non-secret leading slice for identifying a key in
// the UI. A verified key routes an inbound request to its owning tenant.
export const apiKeys = sqliteTable("api_keys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  label: text("label"),
  scopes: text("scopes").notNull().default("leads"),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type ClientCredential = typeof clientCredentials.$inferSelect;
export type ClientSession = typeof clientSessions.$inferSelect;

/**
 * Multi-account identity: a person's (users) access to one clinic (tenants) with
 * a per-clinic role. Replaces the single users.tenant_id/users.role binding — one
 * identity can hold many memberships. UNIQUE(user_id, tenant_id): at most one
 * membership per person per clinic.
 */
export const memberships = sqliteTable(
  "memberships",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["admin", "staff"] }).notNull().default("staff"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    userTenantUnique: uniqueIndex("idx_memberships_user_tenant").on(
      t.userId,
      t.tenantId,
    ),
    tenantIdx: index("idx_memberships_tenant").on(t.tenantId),
  }),
);

export const videoProjects = sqliteTable("video_projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  aspectRatio: text("aspect_ratio", { enum: ["9:16", "1:1"] }).notNull(),
  targetSeconds: integer("target_seconds").notNull().default(45),
  toneNotes: text("tone_notes"),
  status: text("status", {
    enum: [
      "queued",
      "transcribing",
      "transcribed",
      "planning",
      "rendering",
      "rendered",
      "failed",
    ],
  })
    .notNull()
    .default("queued"),
  error: text("error"),
  transcriptJson: text("transcript_json"),
  planJson: text("plan_json"),
  /**
   * The editable edit document for the CapCut-style editor:
   * `{ mainSegments: {sourceStart,sourceEnd}[], brollInserts: [...] }`.
   * Null on legacy projects — synthesized from planJson + auto-trim on open.
   */
  timelineJson: text("timeline_json"),
  outputFilename: text("output_filename"),
  captionFont: text("caption_font").notNull().default("Arial Black"),
  musicFilename: text("music_filename"),
  musicVolume: real("music_volume").notNull().default(0.2),
  autoTrimSilence: integer("auto_trim_silence", { mode: "boolean" })
    .notNull()
    .default(false),
  showIntroOutro: integer("show_intro_outro", { mode: "boolean" })
    .notNull()
    .default(false),
  introDurationSec: real("intro_duration_sec").notNull().default(1.6),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const videoAssets = sqliteTable("video_assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => videoProjects.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["main", "broll"] }).notNull(),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  durationSeconds: real("duration_seconds"),
  width: integer("width"),
  height: integer("height"),
  /** Display rotation in degrees (0/90/180/270). Used to transpose at render. */
  rotation: integer("rotation").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const imageLibraryAssets = sqliteTable("image_library_assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  // 'image' | 'video' — the library is a unified media pool.
  kind: text("kind").notNull().default("image"),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width"),
  height: integer("height"),
  label: text("label"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const imageDesigns = sqliteTable("image_designs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  templateId: text("template_id").notNull(),
  aspectRatio: text("aspect_ratio", {
    enum: ["1:1", "9:16", "4:5"],
  }).notNull(),
  headingText: text("heading_text").notNull().default(""),
  bodyText: text("body_text").notNull().default(""),
  tagline: text("tagline"),
  accentColor: text("accent_color").notNull().default("#2c6ce0"),
  backgroundAssetId: integer("background_asset_id").references(
    () => imageLibraryAssets.id,
    { onDelete: "set null" },
  ),
  backgroundFit: text("background_fit", {
    enum: ["cover", "contain"],
  })
    .notNull()
    .default("cover"),
  backgroundOffsetX: real("background_offset_x").notNull().default(0.5),
  backgroundOffsetY: real("background_offset_y").notNull().default(0.5),
  backgroundZoom: real("background_zoom").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const carouselSets = sqliteTable("carousel_sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const carouselSlides = sqliteTable("carousel_slides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  carouselSetId: integer("carousel_set_id")
    .notNull()
    .references(() => carouselSets.id, { onDelete: "cascade" }),
  /**
   * Independent carousel slot inside a design. Lets a single design hold
   * multiple carousels — each keyed by the template tab the user clicked when
   * generating (e.g. 'carousel-cover', 'carousel-content', 'question-hook').
   * Defaults to 'default' for single-image designs and legacy data.
   */
  slotKey: text("slot_key").notNull().default("default"),
  slideOrder: integer("slide_order").notNull().default(0),
  templateId: text("template_id").notNull(),
  aspectRatio: text("aspect_ratio", {
    enum: ["1:1", "9:16", "4:5"],
  }).notNull(),
  headingText: text("heading_text").notNull().default(""),
  bodyText: text("body_text").notNull().default(""),
  tagline: text("tagline"),
  /**
   * Caption for the post that this slide belongs to. By convention, we only
   * store the caption on slide[0] of each slot — that's the carousel's
   * caption, used when posting to social. Other slides keep this empty.
   */
  caption: text("caption").notNull().default(""),
  /** Font family override (font id from lib/image/fonts.ts). Null = template default. */
  headingFont: text("heading_font"),
  bodyFont: text("body_font"),
  accentColor: text("accent_color").notNull().default("#2c6ce0"),
  // Solid background colour used when no background photo is set (nullable).
  backgroundColor: text("background_color"),
  backgroundAssetId: integer("background_asset_id").references(
    () => imageLibraryAssets.id,
    { onDelete: "set null" },
  ),
  backgroundFit: text("background_fit", {
    enum: ["cover", "contain"],
  })
    .notNull()
    .default("cover"),
  backgroundOffsetX: real("background_offset_x").notNull().default(0.5),
  backgroundOffsetY: real("background_offset_y").notNull().default(0.5),
  backgroundZoom: real("background_zoom").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const blogPosts = sqliteTable("blog_posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  inputMode: text("input_mode", {
    enum: ["prompt", "therapy", "video"],
  }).notNull(),
  sourceVideoProjectId: integer("source_video_project_id").references(
    () => videoProjects.id,
    { onDelete: "set null" },
  ),
  sourceTherapyId: integer("source_therapy_id").references(() => therapies.id, {
    onDelete: "set null",
  }),
  prompt: text("prompt"),
  tone: text("tone"),
  targetWords: integer("target_words").notNull().default(700),
  content: text("content"),
  status: text("status", {
    enum: ["generating", "ready", "failed"],
  })
    .notNull()
    .default("generating"),
  error: text("error"),
  // CMS extensions (site scoping + SEO + publish lifecycle).
  siteId: integer("site_id").references(() => sites.id, {
    onDelete: "cascade",
  }),
  slug: text("slug"),
  excerpt: text("excerpt"),
  // Hero/cover image shown at the top of the post + on list cards. Stores a
  // public media URL (from the shared CMS library, /library-media/…), plus its
  // frame aspect ratio (CSS value, e.g. "16 / 9") and focal point
  // (object-position, e.g. "50% 30%") so tall images can be cropped nicely.
  coverImageUrl: text("cover_image_url"),
  coverAspect: text("cover_aspect"),
  coverPosition: text("cover_position"),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  ogImageAssetId: integer("og_image_asset_id").references(
    () => mediaAssets.id,
    { onDelete: "set null" },
  ),
  publishState: text("publish_state", {
    enum: ["draft", "scheduled", "published"],
  })
    .notNull()
    .default("draft"),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }),
  scheduledFor: integer("scheduled_for", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  message: text("message").notNull(),
  meta: text("meta"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// ============ CMS (multi-site) — tenant plane ============

export const sites = sqliteTable("sites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  linkedTenantSlug: text("linked_tenant_slug"),
  primaryHost: text("primary_host"),
  defaultLocale: text("default_locale").notNull().default("en"),
  themeJson: text("theme_json"),
  status: text("status", { enum: ["draft", "live"] })
    .notNull()
    .default("draft"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const mediaAssets = sqliteTable(
  "media_assets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    alt: text("alt"),
    label: text("label"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ bySite: index("idx_media_assets_site").on(t.siteId) }),
);

export const pages = sqliteTable(
  "pages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    pageKey: text("page_key").notNull(),
    path: text("path").notNull(),
    title: text("title"),
    templateId: text("template_id").notNull(),
    status: text("status", { enum: ["draft", "published"] })
      .notNull()
      .default("draft"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    sortOrder: integer("sort_order").notNull().default(0),
    showInSitemap: integer("show_in_sitemap", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    bySite: index("idx_pages_site").on(t.siteId),
    sitePath: uniqueIndex("ux_pages_site_path").on(t.siteId, t.path),
  }),
);

export const contentBlocks = sqliteTable(
  "content_blocks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    pageId: integer("page_id").references(() => pages.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["text", "richtext", "image", "html"] })
      .notNull()
      .default("richtext"),
    value: text("value"),
    mediaAssetId: integer("media_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    updatedBy: integer("updated_by"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    lookup: index("idx_content_blocks_lookup").on(t.siteId, t.pageId, t.name),
  }),
);

export const seoMeta = sqliteTable(
  "seo_meta",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    pageId: integer("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    canonicalUrl: text("canonical_url"),
    ogImageAssetId: integer("og_image_asset_id").references(
      () => mediaAssets.id,
      { onDelete: "set null" },
    ),
    robots: text("robots").notNull().default("index,follow"),
    jsonLd: text("json_ld"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ byPage: uniqueIndex("ux_seo_meta_page").on(t.siteId, t.pageId) }),
);

export const siteRequests = sqliteTable("site_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessName: text("business_name").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  notes: text("notes"),
  status: text("status", { enum: ["new", "approved", "declined", "fulfilled"] })
    .notNull()
    .default("new"),
  siteId: integer("site_id").references(() => sites.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// ============ CMS host routing — control plane ============

export const siteDomains = sqliteTable(
  "site_domains",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    host: text("host").notNull().unique(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: integer("site_id").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    byTenantSite: index("idx_site_domains_tenant_site").on(
      t.tenantId,
      t.siteId,
    ),
  }),
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type Therapy = typeof therapies.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Package = typeof packages.$inferSelect;
export type NewPackage = typeof packages.$inferInsert;
export type PackageTemplate = typeof packageTemplates.$inferSelect;
export type NewPackageTemplate = typeof packageTemplates.$inferInsert;
export type Voucher = typeof giftVouchers.$inferSelect;
export type NewVoucher = typeof giftVouchers.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type ActivityEntry = typeof activityLog.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type BlockOut = typeof blockOuts.$inferSelect;
export type NewBlockOut = typeof blockOuts.$inferInsert;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadMessage = typeof leadMessages.$inferSelect;
export type NewLeadMessage = typeof leadMessages.$inferInsert;
export type ClientMessage = typeof clientMessages.$inferSelect;
export type NewClientMessage = typeof clientMessages.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type ConversationTag = typeof conversationTags.$inferSelect;
export type NewConversationTag = typeof conversationTags.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;
export type VideoProject = typeof videoProjects.$inferSelect;
export type NewVideoProject = typeof videoProjects.$inferInsert;
export type VideoAsset = typeof videoAssets.$inferSelect;
export type NewVideoAsset = typeof videoAssets.$inferInsert;
export type BlogPost = typeof blogPosts.$inferSelect;
export type NewBlogPost = typeof blogPosts.$inferInsert;
export type ImageLibraryAsset = typeof imageLibraryAssets.$inferSelect;
export type NewImageLibraryAsset = typeof imageLibraryAssets.$inferInsert;
export type ImageDesign = typeof imageDesigns.$inferSelect;
export type NewImageDesign = typeof imageDesigns.$inferInsert;
export type CarouselSet = typeof carouselSets.$inferSelect;
export type NewCarouselSet = typeof carouselSets.$inferInsert;
export type CarouselSlide = typeof carouselSlides.$inferSelect;
export type NewCarouselSlide = typeof carouselSlides.$inferInsert;
export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type MediaAsset = typeof mediaAssets.$inferSelect;
export type NewMediaAsset = typeof mediaAssets.$inferInsert;
export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
export type ContentBlock = typeof contentBlocks.$inferSelect;
export type NewContentBlock = typeof contentBlocks.$inferInsert;
export type SeoMeta = typeof seoMeta.$inferSelect;
export type NewSeoMeta = typeof seoMeta.$inferInsert;
export type SiteDomain = typeof siteDomains.$inferSelect;
export type NewSiteDomain = typeof siteDomains.$inferInsert;
export type SiteRequest = typeof siteRequests.$inferSelect;
export type NewSiteRequest = typeof siteRequests.$inferInsert;
export type BlockKind = ContentBlock["kind"];

// ─────────────────────────────────────────────────────────────────────────────
// Timetable / program management. Group class scheduling: a recurring class
// definition (class_schedules) materializes dated occurrences (class_sessions)
// that clients book into (session_bookings). Named class_* to avoid the existing
// auth `sessions`.
// ─────────────────────────────────────────────────────────────────────────────

export const classSchedules = sqliteTable("class_schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  color: text("color").notNull().default("#3b82f6"),
  capacity: integer("capacity").notNull().default(1),
  location: text("location"),
  instructor: text("instructor"),
  visibility: text("visibility", {
    enum: ["public", "clients", "private"],
  })
    .notNull()
    .default("public"),
  /** CSV of weekday numbers 0–6 (Sun–Sat), e.g. "1,3,5". */
  daysOfWeek: text("days_of_week").notNull(),
  startTime: text("start_time").notNull(), // HH:mm
  durationMin: integer("duration_min").notNull().default(60),
  startDate: text("start_date").notNull(), // YYYY-MM-DD — recurrence begins
  endDate: text("end_date"), // nullable = open-ended
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const classSessions = sqliteTable(
  "class_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Null for a one-off session; set when generated from a schedule. */
    scheduleId: integer("schedule_id").references(() => classSchedules.id, {
      onDelete: "set null",
    }),
    date: text("date").notNull(), // YYYY-MM-DD
    startTime: text("start_time").notNull(), // HH:mm
    endTime: text("end_time").notNull(), // HH:mm
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    color: text("color").notNull().default("#3b82f6"),
    capacity: integer("capacity").notNull().default(1),
    location: text("location"),
    instructor: text("instructor"),
    visibility: text("visibility", {
      enum: ["public", "clients", "private"],
    })
      .notNull()
      .default("public"),
    status: text("status", { enum: ["scheduled", "cancelled"] })
      .notNull()
      .default("scheduled"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    byDate: index("idx_class_sessions_date").on(t.date),
    // Prevents duplicate materialization of a recurring occurrence. One-off
    // sessions have a null schedule_id (nulls are distinct), so they never clash.
    bySlot: uniqueIndex("idx_class_sessions_schedule_slot").on(
      t.scheduleId,
      t.date,
      t.startTime,
    ),
  }),
);

export const sessionBookings = sqliteTable(
  "session_bookings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => classSessions.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["booked", "attended", "no_show", "cancelled"],
    })
      .notNull()
      .default("booked"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    uniq: uniqueIndex("idx_session_bookings_unique").on(t.sessionId, t.clientId),
    bySession: index("idx_session_bookings_session").on(t.sessionId),
  }),
);

export type ClassSchedule = typeof classSchedules.$inferSelect;
export type NewClassSchedule = typeof classSchedules.$inferInsert;
export type ClassSession = typeof classSessions.$inferSelect;
export type NewClassSession = typeof classSessions.$inferInsert;
export type SessionBooking = typeof sessionBookings.$inferSelect;
export type NewSessionBooking = typeof sessionBookings.$inferInsert;

// ── Memberships (recurring products) ──────────────────────────────────────────

export const membershipPlans = sqliteTable("membership_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  /** Price charged each billing cycle, in cents. */
  priceCents: integer("price_cents").notNull().default(0),
  billingInterval: text("billing_interval", { enum: ["week", "month", "year"] })
    .notNull()
    .default("month"),
  /** e.g. every 4 weeks → billingInterval=week, billingCount=4. */
  billingCount: integer("billing_count").notNull().default(1),
  unlimitedSessions: integer("unlimited_sessions", { mode: "boolean" }).notNull().default(false),
  /** Sessions allowed per billing period (ignored when unlimited). */
  sessionsQuantity: integer("sessions_quantity").notNull().default(1),
  visibility: text("visibility", { enum: ["all", "private"] }).notNull().default("all"),
  joiningFeeCents: integer("joining_fee_cents").notNull().default(0),
  openAccess: integer("open_access", { mode: "boolean" }).notNull().default(false),
  priorityBooking: integer("priority_booking", { mode: "boolean" }).notNull().default(false),
  forSale: integer("for_sale", { mode: "boolean" }).notNull().default(true),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const clientMemberships = sqliteTable(
  "client_memberships",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    membershipId: integer("membership_id").references(() => membershipPlans.id, {
      onDelete: "set null",
    }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** Snapshots so the record survives catalog edits/deletes. */
    membershipName: text("membership_name").notNull(),
    priceCents: integer("price_cents").notNull().default(0),
    status: text("status", { enum: ["active", "expired", "cancelled"] })
      .notNull()
      .default("active"),
    startDate: text("start_date").notNull(),
    nextBillingDate: text("next_billing_date"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    byClient: index("idx_client_memberships_client").on(t.clientId),
    byMembership: index("idx_client_memberships_membership").on(t.membershipId),
  }),
);

export type MembershipPlan = typeof membershipPlans.$inferSelect;
export type NewMembershipPlan = typeof membershipPlans.$inferInsert;
export type ClientMembership = typeof clientMemberships.$inferSelect;
export type NewClientMembership = typeof clientMemberships.$inferInsert;

// ── Session Packages (prepaid credit bundles) ─────────────────────────────────

export const packagePlans = sqliteTable("package_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  priceCents: integer("price_cents").notNull().default(0),
  unlimitedSessions: integer("unlimited_sessions", { mode: "boolean" }).notNull().default(false),
  /** Number of session credits in the bundle (ignored when unlimited). */
  sessionsQuantity: integer("sessions_quantity").notNull().default(1),
  unlimitedDuration: integer("unlimited_duration", { mode: "boolean" }).notNull().default(false),
  /** Validity after purchase, e.g. 4 weeks → interval=week, count=4. */
  expirationCount: integer("expiration_count").notNull().default(1),
  expirationInterval: text("expiration_interval", { enum: ["week", "month", "year"] })
    .notNull()
    .default("month"),
  singlePurchase: integer("single_purchase", { mode: "boolean" }).notNull().default(false),
  activateOnFirstBooking: integer("activate_on_first_booking", { mode: "boolean" })
    .notNull()
    .default(false),
  autoRenewal: integer("auto_renewal", { mode: "boolean" }).notNull().default(false),
  restrictToMembers: integer("restrict_to_members", { mode: "boolean" }).notNull().default(false),
  visibility: text("visibility", { enum: ["all", "private"] }).notNull().default("all"),
  openAccess: integer("open_access", { mode: "boolean" }).notNull().default(false),
  priorityBooking: integer("priority_booking", { mode: "boolean" }).notNull().default(false),
  forSale: integer("for_sale", { mode: "boolean" }).notNull().default(true),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const clientPackages = sqliteTable(
  "client_packages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    packageId: integer("package_id").references(() => packagePlans.id, { onDelete: "set null" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    packageName: text("package_name").notNull(),
    priceCents: integer("price_cents").notNull().default(0),
    sessionsTotal: integer("sessions_total").notNull().default(0),
    unlimitedSessions: integer("unlimited_sessions", { mode: "boolean" }).notNull().default(false),
    sessionsUsed: integer("sessions_used").notNull().default(0),
    status: text("status", { enum: ["active", "expired", "cancelled"] })
      .notNull()
      .default("active"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    /** Activate-on-first-booking packages start inactive until first used. */
    activated: integer("activated", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    byClient: index("idx_client_packages_client").on(t.clientId),
    byPackage: index("idx_client_packages_package").on(t.packageId),
  }),
);

export type PackagePlan = typeof packagePlans.$inferSelect;
export type NewPackagePlan = typeof packagePlans.$inferInsert;
export type ClientPackage = typeof clientPackages.$inferSelect;
export type NewClientPackage = typeof clientPackages.$inferInsert;

// ── Staff (instructors / trainers) ────────────────────────────────────────────

export const staff = sqliteTable("staff", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  title: text("title"),
  payType: text("pay_type", { enum: ["per_session", "per_hour", "fixed"] })
    .notNull()
    .default("per_session"),
  payRateCents: integer("pay_rate_cents").notNull().default(0),
  isApproved: integer("is_approved", { mode: "boolean" }).notNull().default(true),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type Staff = typeof staff.$inferSelect;
export type NewStaff = typeof staff.$inferInsert;

// ── Nutrition (Kahunas-style diet plans) ──────────────────────────────────────

export const nutritionPlans = sqliteTable("nutrition_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().default("New Nutrition Plan"),
  // full = meals with foods · macro = macro targets · upload = attached document
  type: text("type", { enum: ["full", "macro", "upload"] }).notNull(),
  // for macro plans only: per-meal macros vs one daily total
  macroMode: text("macro_mode", { enum: ["per_meal", "daily"] }),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  tags: text("tags"), // comma-separated
  notes: text("notes"),
  uploadFilename: text("upload_filename"),
  uploadOriginalName: text("upload_original_name"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const nutritionDays = sqliteTable(
  "nutrition_days",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    planId: integer("plan_id")
      .notNull()
      .references(() => nutritionPlans.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Day 1"),
    position: integer("position").notNull().default(0),
    notes: text("notes"),
    // used when macroMode = "daily"
    protein: real("protein").notNull().default(0),
    carbs: real("carbs").notNull().default(0),
    fat: real("fat").notNull().default(0),
    calories: real("calories").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ byPlan: index("idx_nutrition_days_plan").on(t.planId) }),
);

export const nutritionMeals = sqliteTable(
  "nutrition_meals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dayId: integer("day_id")
      .notNull()
      .references(() => nutritionDays.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Meal"),
    position: integer("position").notNull().default(0),
    notes: text("notes"),
    // used when macroMode = "per_meal"
    protein: real("protein").notNull().default(0),
    carbs: real("carbs").notNull().default(0),
    fat: real("fat").notNull().default(0),
    calories: real("calories").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ byDay: index("idx_nutrition_meals_day").on(t.dayId) }),
);

export const nutritionFoods = sqliteTable(
  "nutrition_foods",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    mealId: integer("meal_id")
      .notNull()
      .references(() => nutritionMeals.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    quantity: real("quantity").notNull().default(1),
    unit: text("unit"),
    // macro totals for this food row (as entered / scaled)
    protein: real("protein").notNull().default(0),
    carbs: real("carbs").notNull().default(0),
    fat: real("fat").notNull().default(0),
    calories: real("calories").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ byMeal: index("idx_nutrition_foods_meal").on(t.mealId) }),
);

export type NutritionPlan = typeof nutritionPlans.$inferSelect;
export type NutritionDay = typeof nutritionDays.$inferSelect;
export type NutritionMeal = typeof nutritionMeals.$inferSelect;
export type NutritionFood = typeof nutritionFoods.$inferSelect;

// ── Nutrition libraries: reusable Foods + Meals ───────────────────────────────

export const foodLibrary = sqliteTable("food_library", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category"),
  // macros are per one serving (serving_size + serving_unit, e.g. 100 g)
  servingSize: real("serving_size").notNull().default(100),
  servingUnit: text("serving_unit").notNull().default("g"),
  protein: real("protein").notNull().default(0),
  carbs: real("carbs").notNull().default(0),
  fat: real("fat").notNull().default(0),
  calories: real("calories").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const mealTemplates = sqliteTable("meal_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().default("New Meal"),
  category: text("category"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const mealTemplateItems = sqliteTable(
  "meal_template_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    mealId: integer("meal_id")
      .notNull()
      .references(() => mealTemplates.id, { onDelete: "cascade" }),
    // optional link back to the library food (kept even if the food is edited)
    foodId: integer("food_id").references(() => foodLibrary.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    quantity: real("quantity").notNull().default(1),
    unit: text("unit"),
    // resolved macro totals for this item (base × quantity)
    protein: real("protein").notNull().default(0),
    carbs: real("carbs").notNull().default(0),
    fat: real("fat").notNull().default(0),
    calories: real("calories").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ byMeal: index("idx_meal_items_meal").on(t.mealId) }),
);

export type FoodLibraryItem = typeof foodLibrary.$inferSelect;
export type MealTemplate = typeof mealTemplates.$inferSelect;
export type MealTemplateItem = typeof mealTemplateItems.$inferSelect;

// ── Workout (Kahunas-style programs + exercise library) ───────────────────────

export const exerciseLibrary = sqliteTable("exercise_library", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category"), // primary group / movement, e.g. "Chest"
  muscleGroups: text("muscle_groups"), // comma-separated, for volume totals
  equipment: text("equipment"),
  videoUrl: text("video_url"),
  imageUrl: text("image_url"),
  instructions: text("instructions"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const workoutPrograms = sqliteTable("workout_programs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().default("New Program"),
  // simple = rich-text content · detailed = days/sections/exercises · upload = document
  type: text("type", { enum: ["simple", "detailed", "upload"] }).notNull(),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  tags: text("tags"),
  summary: text("summary"), // "Workout summary" (simple) / "Program overview" (detailed)
  content: text("content"), // simple: the workout content
  uploadFilename: text("upload_filename"),
  uploadOriginalName: text("upload_original_name"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const workoutDays = sqliteTable(
  "workout_days",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    programId: integer("program_id")
      .notNull()
      .references(() => workoutPrograms.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Day 1"),
    position: integer("position").notNull().default(0),
    instructions: text("instructions"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ byProgram: index("idx_workout_days_program").on(t.programId) }),
);

export const workoutExercises = sqliteTable(
  "workout_exercises",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dayId: integer("day_id")
      .notNull()
      .references(() => workoutDays.id, { onDelete: "cascade" }),
    section: text("section", { enum: ["warmup", "workout", "cooldown"] })
      .notNull()
      .default("workout"),
    exerciseId: integer("exercise_id").references(() => exerciseLibrary.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    sets: integer("sets").notNull().default(0),
    reps: text("reps"), // free text: "12", "40 seconds", "AMRAP"
    restSeconds: integer("rest_seconds").notNull().default(0),
    notes: text("notes"),
    muscleGroups: text("muscle_groups"), // denormalized from the library exercise
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ byDay: index("idx_workout_exercises_day").on(t.dayId) }),
);

export type ExerciseLibraryItem = typeof exerciseLibrary.$inferSelect;
export type WorkoutProgram = typeof workoutPrograms.$inferSelect;
export type WorkoutDay = typeof workoutDays.$inferSelect;
export type WorkoutExercise = typeof workoutExercises.$inferSelect;

// ── Individual workouts (Kahunas "Workout" — standalone single-day sessions) ───

export const workouts = sqliteTable("workouts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().default("New Workout"),
  tags: text("tags"),
  instructions: text("instructions"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const workoutItems = sqliteTable(
  "workout_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workoutId: integer("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    section: text("section", { enum: ["warmup", "workout", "cooldown"] })
      .notNull()
      .default("workout"),
    exerciseId: integer("exercise_id").references(() => exerciseLibrary.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    sets: integer("sets").notNull().default(0),
    reps: text("reps"),
    restSeconds: integer("rest_seconds").notNull().default(0),
    notes: text("notes"),
    muscleGroups: text("muscle_groups"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ byWorkout: index("idx_workout_items_workout").on(t.workoutId) }),
);

export type Workout = typeof workouts.$inferSelect;
export type WorkoutItem = typeof workoutItems.$inferSelect;

// ── Circuits (Kahunas — rounds-based single-list workouts) ────────────────────

export const circuits = sqliteTable("circuits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().default("New Circuit"),
  tags: text("tags"),
  rounds: integer("rounds").notNull().default(3),
  restBetweenSeconds: integer("rest_between_seconds").notNull().default(0),
  instructions: text("instructions"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const circuitItems = sqliteTable(
  "circuit_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    circuitId: integer("circuit_id")
      .notNull()
      .references(() => circuits.id, { onDelete: "cascade" }),
    exerciseId: integer("exercise_id").references(() => exerciseLibrary.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    sets: integer("sets").notNull().default(0),
    reps: text("reps"),
    restSeconds: integer("rest_seconds").notNull().default(0),
    notes: text("notes"),
    muscleGroups: text("muscle_groups"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ byCircuit: index("idx_circuit_items_circuit").on(t.circuitId) }),
);

export type Circuit = typeof circuits.$inferSelect;
export type CircuitItem = typeof circuitItems.$inferSelect;

// ── Automations (Kahunas "Triggers") ──────────────────────────────────────────

export const automationTriggers = sqliteTable("automation_triggers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(), // one of TRIGGER_CATALOG keys
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  externalEnabled: integer("external_enabled", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const automationMessages = sqliteTable(
  "automation_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    triggerKey: text("trigger_key").notNull(),
    position: integer("position").notNull().default(0),
    channel: text("channel", { enum: ["email", "push", "chat"] }).notNull().default("chat"),
    subject: text("subject"),
    template: text("template"),
    attachmentFilename: text("attachment_filename"),
    attachmentOriginal: text("attachment_original"),
    delayValue: integer("delay_value").notNull().default(0),
    delayUnit: text("delay_unit", { enum: ["minutes", "hours", "days"] }).notNull().default("minutes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ byTrigger: index("idx_automation_messages_trigger").on(t.triggerKey) }),
);

export const automationLog = sqliteTable("automation_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  triggerKey: text("trigger_key").notNull(),
  triggerName: text("trigger_name").notNull(),
  channel: text("channel").notNull(),
  subject: text("subject"),
  sentTo: text("sent_to"),
  status: text("status").notNull().default("sent"),
  sentAt: integer("sent_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type AutomationTrigger = typeof automationTriggers.$inferSelect;
export type AutomationMessage = typeof automationMessages.$inferSelect;
export type AutomationLogRow = typeof automationLog.$inferSelect;

// ── Forms (Kahunas — questionnaires, check-ins, habits, contact, terms) ────────

export const forms = sqliteTable(
  "forms",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type", {
      enum: ["initial", "checkin", "habits", "contact", "terms"],
    }).notNull(),
    title: text("title").notNull().default(""),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    status: integer("status", { mode: "boolean" }).notNull().default(true),
    triggerStatus: integer("trigger_status", { mode: "boolean" }).notNull().default(false),
    content: text("content"), // terms body
    shareSlug: text("share_slug"), // contact form public link
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ byType: index("idx_forms_type").on(t.type) }),
);

export const formQuestions = sqliteTable(
  "form_questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    formId: integer("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    section: text("section").notNull().default("main"), // main | checkin | habit | progress
    label: text("label").notNull(),
    fieldType: text("field_type").notNull().default("short"), // number|short|long|dropdown|photo|video|metric
    options: text("options"), // comma-separated (dropdown)
    required: integer("required", { mode: "boolean" }).notNull().default(false),
    isMetric: integer("is_metric", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ byForm: index("idx_form_questions_form").on(t.formId) }),
);

export type FormRow = typeof forms.$inferSelect;
export type FormQuestionRow = typeof formQuestions.$inferSelect;

// ── Per-client assignment (nutrition plans + workout programs) ────────────────

export const clientNutritionPlans = sqliteTable(
  "client_nutrition_plans",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    planId: integer("plan_id")
      .notNull()
      .references(() => nutritionPlans.id, { onDelete: "cascade" }),
    assignedAt: integer("assigned_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    uniq: uniqueIndex("idx_client_nutrition_uniq").on(t.clientId, t.planId),
    byClient: index("idx_client_nutrition_client").on(t.clientId),
  }),
);

export const clientWorkoutPrograms = sqliteTable(
  "client_workout_programs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    programId: integer("program_id")
      .notNull()
      .references(() => workoutPrograms.id, { onDelete: "cascade" }),
    assignedAt: integer("assigned_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    uniq: uniqueIndex("idx_client_workout_uniq").on(t.clientId, t.programId),
    byClient: index("idx_client_workout_client").on(t.clientId),
  }),
);

export type ClientNutritionPlan = typeof clientNutritionPlans.$inferSelect;
export type ClientWorkoutProgram = typeof clientWorkoutPrograms.$inferSelect;

// ── Agentic OS: agent registry ────────────────────────────────────────────────
// One row per role-based agent this tenant can run. `instructions` is a
// tenant-editable custom layer over that agent's built-in system prompt;
// `status` gates whether it's actually invoked (later tasks wire this up).
export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  status: text("status", { enum: ["active", "dormant"] }).notNull().default("dormant"),
  instructions: text("instructions").notNull().default(""),
  model: text("model").notNull().default("claude-sonnet-5"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
