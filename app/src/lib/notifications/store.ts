import "server-only";

import { and, desc, eq, inArray, isNull, lt, lte, notInArray, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { controlSqlite } from "@/lib/db/control";
import {
  notificationPrefs,
  notificationReads,
  notificationState,
  notifications,
  staffPushSubscriptions,
} from "@/lib/db/schema";
import {
  KEEP_NOTIFICATIONS_MS,
  NOTIFICATION_KINDS,
  isAdminOnlyKind,
  mergePrefs,
  type KindPref,
  type NotificationKind,
  type Prefs,
  type Recipient,
  type StaffRole,
} from "./model";

/**
 * Staff notifications, for the CURRENT tenant (ambient `db`). A notification
 * is one row for the whole business; who has read it is per person
 * (notification_reads, plus notification_state.read_all_before for "Mark all
 * as read"). Staff are control-plane users, so user ids are plain integers.
 */

export interface NewNotification {
  kind: NotificationKind;
  title: string;
  body?: string;
  href: string;
  /** The same key notifies once. */
  key: string;
  /** A personal alert: only this user sees it. */
  forUserId?: number | null;
  now?: number;
}

export interface NotificationItem {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string;
  createdAt: number;
  unread: boolean;
}

/** Insert, or nothing when the key was used before. Returns the new id, or null for a repeat. */
export function createNotification(n: NewNotification): number | null {
  const res = db
    .insert(notifications)
    .values({
      kind: n.kind,
      title: n.title.slice(0, 200),
      body: (n.body ?? "").slice(0, 400),
      href: n.href,
      dedupeKey: n.key.slice(0, 300),
      adminOnly: isAdminOnlyKind(n.kind),
      forUserId: n.forUserId ?? null,
      createdAt: n.now ?? Date.now(),
    })
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning({ id: notifications.id })
    .all();
  if (res[0]) pruneOld(n.now ?? Date.now());
  return res[0]?.id ?? null;
}

/** Drop notifications past KEEP_NOTIFICATIONS_MS, and their read marks. */
function pruneOld(now: number): void {
  const cutoff = now - KEEP_NOTIFICATIONS_MS;
  const old = db.select({ id: notifications.id }).from(notifications).where(lt(notifications.createdAt, cutoff)).all().map((r) => r.id);
  if (old.length === 0) return;
  db.delete(notificationReads).where(inArray(notificationReads.notificationId, old)).run();
  db.delete(notifications).where(inArray(notifications.id, old)).run();
}

/**
 * Everything before this counts as read. Someone seen for the first time
 * starts now, so a new staff member doesn't open the bell to a backlog of
 * other people's old notifications.
 */
function readAllBefore(userId: number): number {
  const row = db.select({ t: notificationState.readAllBefore }).from(notificationState).where(eq(notificationState.userId, userId)).get();
  if (row) return row.t;
  const now = Date.now();
  db.insert(notificationState).values({ userId, readAllBefore: now }).onConflictDoNothing({ target: notificationState.userId }).run();
  return now;
}

/** What this person may see in the bell: their role allows it, the kind is on in the app, and it is for everyone or for them. */
function visibleTo(userId: number, role: StaffRole): SQL | undefined {
  const off = NOTIFICATION_KINDS.filter((k) => !getPrefs(userId)[k].inApp);
  return and(
    role === "admin" ? undefined : eq(notifications.adminOnly, false),
    off.length ? notInArray(notifications.kind, off) : undefined,
    or(isNull(notifications.forUserId), eq(notifications.forUserId, userId)),
  );
}

function unreadExpr(userId: number, before: number): SQL<number> {
  return sql<number>`(${notifications.createdAt} > ${before} and not exists (select 1 from notification_reads r where r.user_id = ${userId} and r.notification_id = ${notifications.id}))`;
}

export function unreadCount(userId: number, role: StaffRole): number {
  const before = readAllBefore(userId);
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(notifications)
    .where(and(visibleTo(userId, role), unreadExpr(userId, before)))
    .get();
  return Number(row?.n ?? 0);
}

/** The latest notifications this person may see, newest first. */
export function listForUser(userId: number, role: StaffRole, limit = 30): NotificationItem[] {
  const before = readAllBefore(userId);
  return db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      createdAt: notifications.createdAt,
      unread: unreadExpr(userId, before),
    })
    .from(notifications)
    .where(visibleTo(userId, role))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit)
    .all()
    .map((r) => ({ ...r, unread: Boolean(r.unread) }));
}

export function markRead(userId: number, notificationId: number): void {
  const exists = db.select({ id: notifications.id }).from(notifications).where(eq(notifications.id, notificationId)).get();
  if (!exists) return;
  db.insert(notificationReads).values({ userId, notificationId }).onConflictDoNothing().run();
}

/** Everything up to now counts as read; the per-item rows it covers are no longer needed. */
export function markAllRead(userId: number, now = Date.now()): void {
  db.insert(notificationState)
    .values({ userId, readAllBefore: now })
    .onConflictDoUpdate({ target: notificationState.userId, set: { readAllBefore: now } })
    .run();
  const covered = db.select({ id: notifications.id }).from(notifications).where(lte(notifications.createdAt, now));
  db.delete(notificationReads)
    .where(and(eq(notificationReads.userId, userId), inArray(notificationReads.notificationId, covered)))
    .run();
}

// ---- Preferences ------------------------------------------------------------

export function getPrefs(userId: number): Prefs {
  return mergePrefs(db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId)).all());
}

export function prefsForUsers(userIds: number[]): Map<number, Prefs> {
  const out = new Map<number, Prefs>();
  if (userIds.length === 0) return out;
  const rows = db.select().from(notificationPrefs).where(inArray(notificationPrefs.userId, userIds)).all();
  for (const id of userIds) out.set(id, mergePrefs(rows.filter((r) => r.userId === id)));
  return out;
}

export function setPref(userId: number, kind: NotificationKind, pref: KindPref): void {
  db.insert(notificationPrefs)
    .values({ userId, kind, inApp: pref.inApp, push: pref.push })
    .onConflictDoUpdate({ target: [notificationPrefs.userId, notificationPrefs.kind], set: { inApp: pref.inApp, push: pref.push } })
    .run();
}

// ---- Who works here -----------------------------------------------------------

/** Every active staff member of a business, with their role there. */
export function staffOf(tenantId: number): Recipient[] {
  return (
    controlSqlite
      .prepare(
        `SELECT m.user_id AS userId, m.role AS role FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.tenant_id = ? AND m.is_active = 1 AND u.is_active = 1`,
      )
      .all(tenantId) as Array<{ userId: number; role: string }>
  ).map((r) => ({ userId: r.userId, role: r.role === "admin" ? "admin" : "staff" }));
}

// ---- This person's devices -----------------------------------------------------

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function savePushSubscription(userId: number, sub: PushSubscriptionInput, userAgent: string | null, now = Date.now()): void {
  const row = { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null, createdAt: now };
  db.insert(staffPushSubscriptions)
    .values(row)
    .onConflictDoUpdate({ target: staffPushSubscriptions.endpoint, set: row })
    .run();
}

export function removePushSubscription(userId: number, endpoint: string): void {
  db.delete(staffPushSubscriptions)
    .where(and(eq(staffPushSubscriptions.userId, userId), eq(staffPushSubscriptions.endpoint, endpoint)))
    .run();
}

export function pushDeviceCount(userId: number): number {
  return db.select({ id: staffPushSubscriptions.id }).from(staffPushSubscriptions).where(eq(staffPushSubscriptions.userId, userId)).all().length;
}

export type StaffSubscription = typeof staffPushSubscriptions.$inferSelect;

export function subscriptionsFor(userIds: number[]): StaffSubscription[] {
  if (userIds.length === 0) return [];
  return db.select().from(staffPushSubscriptions).where(inArray(staffPushSubscriptions.userId, userIds)).all();
}
