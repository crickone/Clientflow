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
  domains: { id: number; host: string; isPrimary: boolean }[];
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
            <Card key={d.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, fontWeight: 500 }}>{d.host}</div>
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
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
