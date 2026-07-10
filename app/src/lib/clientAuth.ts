import "server-only";

import crypto from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { authDb, CLIENT_SESSION_COOKIE } from "@/lib/db/control";
import { clientCredentials, clientSessions, clients, type Client } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth";

export { CLIENT_SESSION_COOKIE, hashPassword };

const TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export interface ClientSessionInfo {
  credentialId: number;
  tenantId: number;
  clientId: number;
}

/** Validate email + password against the control-plane client credentials. */
export function loginClient(email: string, password: string): ClientSessionInfo | null {
  const cred = authDb
    .select()
    .from(clientCredentials)
    .where(eq(clientCredentials.email, email.trim().toLowerCase()))
    .get();
  if (!cred || !cred.isActive) return null;
  if (!verifyPassword(password, cred.passwordHash)) return null;
  authDb.update(clientCredentials).set({ lastLoginAt: new Date() }).where(eq(clientCredentials.id, cred.id)).run();
  return { credentialId: cred.id, tenantId: cred.tenantId, clientId: cred.clientId };
}

export async function createClientSession(info: ClientSessionInfo): Promise<void> {
  const id = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TTL_MS);
  authDb.insert(clientSessions).values({
    id,
    credentialId: info.credentialId,
    tenantId: info.tenantId,
    clientId: info.clientId,
    expiresAt,
  }).run();
  cookies().set(CLIENT_SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroyClientSession(): Promise<void> {
  const token = cookies().get(CLIENT_SESSION_COOKIE)?.value;
  if (token) authDb.delete(clientSessions).where(eq(clientSessions.id, token)).run();
  cookies().delete(CLIENT_SESSION_COOKIE);
}

/** The current client-app session (memoised), or null. */
export const getClientSession = cache((): ClientSessionInfo | null => {
  let token: string | undefined;
  try {
    token = cookies().get(CLIENT_SESSION_COOKIE)?.value;
  } catch {
    return null;
  }
  if (!token) return null;
  const row = authDb.select().from(clientSessions).where(eq(clientSessions.id, token)).get();
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return { credentialId: row.credentialId, tenantId: row.tenantId, clientId: row.clientId };
});

export interface CurrentClient {
  clientId: number;
  tenantId: number;
  client: Client;
}

/** Resolve the signed-in client's row from their tenant DB (db proxy resolves it). */
export function getCurrentClient(): CurrentClient | null {
  const s = getClientSession();
  if (!s) return null;
  const client = db.select().from(clients).where(eq(clients.id, s.clientId)).get();
  if (!client) return null;
  return { clientId: s.clientId, tenantId: s.tenantId, client };
}

export function requireClient(): CurrentClient {
  const c = getCurrentClient();
  if (!c) throw new Error("UNAUTHENTICATED_CLIENT");
  return c;
}

/** Page guard: redirect to the client login when not signed in. */
export function requireClientPage(): CurrentClient {
  const c = getCurrentClient();
  if (!c) redirect("/app/login");
  return c;
}

export function purgeExpiredClientSessions() {
  authDb.delete(clientSessions).where(lt(clientSessions.expiresAt, new Date())).run();
}
