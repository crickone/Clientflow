"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Star, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { FieldError, Input, Label } from "@/components/ui/Input";
import {
  addDomainAction,
  removeDomainAction,
  makePrimaryAction,
  verifyDomainAction,
  type DomainState,
} from "@/app/cms/[siteSlug]/domains/actions";

const initial: DomainState = { ok: false };

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Adding…" : "Add domain"}
    </Button>
  );
}

export function DomainsManager({
  siteSlug,
  domains,
}: {
  siteSlug: string;
  domains: {
    id: number;
    host: string;
    isPrimary: boolean;
    verified: boolean;
    verifyToken: string | null;
  }[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const action = addDomainAction.bind(null, siteSlug);
  const [state, formAction] = useFormState(action, initial);

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 640 }}>
      <form
        action={async (fd) => {
          const res = await formAction(fd);
          // useFormState updates `state`; refresh list on success
          router.refresh();
          return res;
        }}
      >
        <Card style={{ display: "grid", gap: 14 }}>
          <div>
            <Label htmlFor="host">Add a domain</Label>
            <Input id="host" name="host" placeholder="renovacellular.ie" />
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
            <input type="checkbox" name="isPrimary" /> Set as primary (canonical) host
          </label>
          <FieldError message={state.error} />
          <div>
            <AddButton />
          </div>
        </Card>
      </form>

      {domains.length === 0 ? (
        <p style={{ color: "var(--text-tertiary)" }}>No domains mapped yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {domains.map((d) => (
            <Card key={d.id} style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, fontWeight: 500 }}>{d.host}</div>
                {d.verified ? (
                  <Badge colour="#3fb950">verified</Badge>
                ) : (
                  <Badge colour="#d29922">pending verification</Badge>
                )}
                {d.isPrimary && <Badge colour="#3fb950">primary</Badge>}
                {!d.isPrimary && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      startTransition(async () => {
                        await makePrimaryAction(siteSlug, d.id);
                        toast.success("Set primary");
                        router.refresh();
                      })
                    }
                  >
                    <Star size={14} /> Make primary
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    startTransition(async () => {
                      await removeDomainAction(siteSlug, d.id);
                      router.refresh();
                    })
                  }
                >
                  <Trash2 size={14} />
                </Button>
              </div>

              {!d.verified && (
                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    padding: "10px 12px",
                    background: "var(--surface-2)",
                    border: "1px solid var(--hairline)",
                    borderRadius: "var(--radius)",
                    fontSize: 13,
                  }}
                >
                  <div style={{ color: "var(--text-secondary)" }}>
                    Prove you own this domain: add a <strong>TXT</strong> record at
                    your DNS provider, then verify. The site won&apos;t serve on
                    this host until it&apos;s verified.
                  </div>
                  <div style={{ display: "grid", gap: 4, fontFamily: "var(--font-mono), monospace", fontSize: 12 }}>
                    <div>
                      <span style={{ color: "var(--text-tertiary)" }}>Name: </span>
                      _adonisagent-verify.{d.host}
                    </div>
                    <div style={{ wordBreak: "break-all" }}>
                      <span style={{ color: "var(--text-tertiary)" }}>Value: </span>
                      {d.verifyToken ?? "(shown after first verify attempt)"}
                    </div>
                  </div>
                  <div>
                    <Button
                      size="sm"
                      onClick={() =>
                        startTransition(async () => {
                          const res = await verifyDomainAction(siteSlug, d.id);
                          if (res.ok) toast.success("Domain verified");
                          else toast.error(res.error ?? "Verification failed");
                          router.refresh();
                        })
                      }
                    >
                      Verify
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
