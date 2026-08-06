"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";
import {
  createApiKeyAction,
  revokeApiKeyAction,
} from "@/app/settings/api-keys/actions";

export type ApiKeyRow = {
  id: number;
  prefix: string;
  label: string | null;
  scopes: string;
  lastUsedAt: number | null;
  createdAt: number;
  revokedAt: number | null;
};

const fmt = (ms: number) =>
  new Date(ms).toLocaleString("en-IE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export function ApiKeysManager({ keys }: { keys: ApiKeyRow[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {keys.length === 0 && (
        <Card style={{ padding: 22, color: "var(--text-secondary)", fontSize: 14 }}>
          No API keys yet. Create one to let an integration post leads into this
          account.
        </Card>
      )}
      {keys.map((k) => (
        <KeyRow key={k.id} apiKey={k} />
      ))}
      <CreateKeyButton />
    </div>
  );
}

function KeyRow({ apiKey: k }: { apiKey: ApiKeyRow }) {
  const revoked = k.revokedAt != null;
  return (
    <Card
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: 18,
        opacity: revoked ? 0.6 : 1,
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: "var(--radius)",
          background: "var(--surface-2)",
          border: "1px solid var(--hairline)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-primary)",
          flexShrink: 0,
        }}
      >
        <KeyRound size={17} strokeWidth={1.6} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span
            style={{
              color: "var(--text-primary)",
              fontWeight: 500,
              fontSize: 15,
            }}
          >
            {k.label || "Untitled key"}
          </span>
          <Badge tone="neutral">{k.scopes}</Badge>
          {revoked && <Badge tone="red">Revoked</Badge>}
        </div>
        <div
          style={{
            color: "var(--text-tertiary)",
            fontSize: 12,
            marginTop: 4,
          }}
        >
          <code style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}>
            {k.prefix}…
          </code>
          {" · created "}
          {fmt(k.createdAt)}
          {" · "}
          {k.lastUsedAt ? `last used ${fmt(k.lastUsedAt)}` : "never used"}
        </div>
      </div>
      {!revoked && <RevokeKeyButton apiKey={k} />}
    </Card>
  );
}

function CreateKeyButton() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState("leads");
  // Set once the key is minted; the dialog then shows the raw secret ONCE.
  const [created, setCreated] = useState<{ raw: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setLabel("");
    setScope("leads");
    setCreated(null);
    setCopied(false);
  }

  function submit() {
    start(async () => {
      const res = await createApiKeyAction({ label, scope });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setCreated({ raw: res.raw });
    });
  }

  async function copyKey() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.raw);
      setCopied(true);
      toast.success("Key copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the key and copy it manually.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" style={{ alignSelf: "flex-start" }}>
          <Plus size={14} strokeWidth={2} />
          Create key
        </Button>
      </DialogTrigger>
      <DialogContent title={created ? "Copy your API key" : "Create API key"}>
        {created ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                background: "rgba(251, 191, 36, 0.1)",
                border: "1px solid rgba(251, 191, 36, 0.35)",
                color: "#fbbf24",
                fontSize: 13,
                lineHeight: 1.5,
                padding: "10px 12px",
                borderRadius: "var(--radius)",
              }}
            >
              Copy this key now — it won&apos;t be shown again. We only store a hash,
              so it can&apos;t be recovered later. If you lose it, revoke it and
              create a new one.
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "var(--surface-1)",
                border: "1px solid var(--grid)",
                borderRadius: "var(--radius)",
                padding: "10px 12px",
              }}
            >
              <code
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflowX: "auto",
                  whiteSpace: "nowrap",
                  fontFamily: "var(--font-mono), ui-monospace, monospace",
                  fontSize: 13,
                  color: "var(--text-primary)",
                }}
              >
                {created.raw}
              </code>
              <Button variant="ghost" size="icon" onClick={copyKey} title="Copy key">
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </Button>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <Label htmlFor="key-label">Label (optional)</Label>
              <Input
                id="key-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Zapier — Facebook lead-gen"
                autoFocus
                disabled={pending}
              />
              <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 6 }}>
                A name to recognise this key in the list. It doesn&apos;t affect
                what the key can do.
              </div>
            </div>
            <div>
              <Label htmlFor="key-scope">Scope</Label>
              <ScopeSelect value={scope} onChange={setScope} disabled={pending} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
              <DialogClose asChild>
                <Button variant="ghost" disabled={pending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button onClick={submit} disabled={pending}>
                {pending ? "Creating…" : "Create key"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevokeKeyButton({ apiKey: k }: { apiKey: ApiKeyRow }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function confirm() {
    start(async () => {
      const res = await revokeApiKeyAction(k.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Key revoked");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Revoke key">
          <Trash2 size={14} strokeWidth={1.75} />
        </Button>
      </DialogTrigger>
      <DialogContent title="Revoke API key" description={k.label || k.prefix + "…"} width={420}>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.5 }}>
          Any integration using this key will immediately start getting{" "}
          <strong>401 Unauthorized</strong>. This can&apos;t be undone — you&apos;d
          need to create a new key. Leads already received are unaffected.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <DialogClose asChild>
            <Button variant="ghost" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? "Revoking…" : "Revoke"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ScopeSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{
        width: "100%",
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: "10px 14px",
        color: "var(--text-primary)",
        fontSize: 14,
        outline: "none",
        fontFamily: "inherit",
      }}
    >
      <option value="leads">leads — post inbound leads to this account</option>
    </select>
  );
}
