"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const logout = async () => {
    setBusy(true);
    await fetch("/api/client-auth/logout", { method: "POST" });
    router.push("/app/login");
    router.refresh();
  };
  return (
    <button
      onClick={logout}
      disabled={busy}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: 46, borderRadius: "var(--radius)", border: "1px solid var(--hairline)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 14 }}
    >
      <LogOut size={16} /> {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
