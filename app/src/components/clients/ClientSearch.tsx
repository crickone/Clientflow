"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/Input";

export function ClientSearch() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  useEffect(() => {
    const id = setTimeout(() => {
      const next = new URLSearchParams(Array.from(params.entries()));
      if (q) next.set("q", q);
      else next.delete("q");
      router.replace(`/clients${next.size ? "?" + next.toString() : ""}`);
    }, 220);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div style={{ position: "relative", flex: 1, maxWidth: 420 }}>
      <Search
        size={15}
        style={{
          position: "absolute",
          left: 14,
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--text-tertiary)",
        }}
      />
      <Input
        placeholder="Search by name, email, or phone…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ paddingLeft: 38, borderRadius: "var(--radius)" }}
      />
    </div>
  );
}
