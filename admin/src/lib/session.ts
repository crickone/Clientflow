import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { api, ApiError, ADMIN_COOKIE } from "./api";

export interface AdminUser { userId: number; email: string; name: string | null }

/** Page guard: verified against /auth/me; redirects to /login when invalid. */
export const requireAdminSession = cache(async (): Promise<AdminUser> => {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (!token) redirect("/login");
  try {
    const { user } = await api<{ user: AdminUser }>("/auth/me");
    return user;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 404)) redirect("/login");
    throw err;
  }
});
