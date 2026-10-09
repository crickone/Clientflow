"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Copy, Globe, Info, RefreshCw, Star, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  addDomainAction,
  removeDomainAction,
  makePrimaryAction,
  recheckDomainAction,
  verifyDomainAction,
  type DomainState,
} from "@/app/cms/[siteSlug]/domains/actions";

const initial: DomainState = { ok: false };

export interface DomainRow {
  id: number;
  host: string;
  isPrimary: boolean;
  verified: boolean;
  verifyToken: string | null;
  /** A bare domain, which most registrars cannot CNAME. */
  apex: boolean;
  /** DNS already CNAMEs to the platform; null when there was no CNAME answer. */
  pointed: boolean | null;
  /** Cloudflare's view; null when client domains are not configured. */
  https: { state: "active" | "pending" | "failed" | "missing"; detail: string } | null;
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {pending ? "Adding" : "Add domain"}
    </Button>
  );
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="dm-rec">
      <span className="dm-rec-k">{label}</span>
      <code className="dm-rec-v">{value}</code>
      <button
        type="button"
        className="dm-copy"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          } catch {
            toast.error("Couldn't copy. Select the text instead.");
          }
        }}
      >
        {done ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function Step({ n, title, state, children }: { n: number; title: string; state: "done" | "todo" | "wait"; children?: React.ReactNode }) {
  return (
    <li className={`dm-step is-${state}`}>
      <span className="dm-step-mark" aria-hidden>
        {state === "done" ? <Check size={13} strokeWidth={3} /> : n}
      </span>
      <div className="dm-step-body">
        <div className="dm-step-title">
          {title}
          <span className="dm-step-state">{state === "done" ? "Done" : state === "wait" ? "Waiting" : "To do"}</span>
        </div>
        {children}
      </div>
    </li>
  );
}

/**
 * Connect a client's own domain to their site, in three steps with live
 * status: prove ownership (TXT), point the domain here (CNAME), and the HTTPS
 * certificate, which Cloudflare issues on its own once the DNS points here.
 */
export function DomainsManager({
  siteSlug,
  domains,
  target,
  configured,
}: {
  siteSlug: string;
  domains: DomainRow[];
  target: string;
  configured: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const action = addDomainAction.bind(null, siteSlug);
  const [state, formAction] = useFormState(action, initial);

  return (
    <div className="dm">
      <form
        action={async (fd) => {
          const res = await formAction(fd);
          router.refresh();
          return res;
        }}
        className="dm-add ui-card"
      >
        <div className="dm-add-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <Label htmlFor="host" srOnly>Domain</Label>
            <Input id="host" name="host" placeholder="www.yourbusiness.ie" error={state.error} />
          </div>
          <AddButton />
        </div>
        <label className="dm-primary">
          <input type="checkbox" name="isPrimary" /> Main address (used for links and search engines)
        </label>
        <FieldError message={state.error} />
        <p className="dm-hint">
          <Info size={13} /> Add the <strong>www</strong> address. A bare address (yourbusiness.ie) is forwarded to it at the
          domain registrar.
        </p>
      </form>

      {!configured && (
        <p className="dm-warn">
          Client domains are not switched on for this platform yet, so the HTTPS step cannot complete. Ownership can still
          be verified now.
        </p>
      )}

      {domains.length === 0 ? (
        <div className="dm-empty">
          <Globe size={18} />
          <span>No domains yet. While there is none, the site is available at its preview address.</span>
        </div>
      ) : (
        domains.map((d) => {
          const live = d.verified && d.https?.state === "active";
          const sub = d.host.split(".")[0];
          return (
            <section key={d.id} className="dm-card ui-card">
              <header className="dm-card-head">
                <div className="dm-host">
                  <span className={`dm-dot${live ? " is-live" : ""}`} aria-hidden />
                  <a href={`https://${d.host}`} target="_blank" rel="noreferrer">
                    {d.host}
                  </a>
                  {d.isPrimary && <span className="dm-pill">Main address</span>}
                </div>
                <span className={`dm-status${live ? " is-live" : ""}`}>{live ? "Live" : "Setting up"}</span>
              </header>

              <ol className="dm-steps">
                <Step n={1} title="Prove you own it" state={d.verified ? "done" : "todo"}>
                  {!d.verified && (
                    <>
                      <p className="dm-p">Add this TXT record at the domain&rsquo;s DNS provider, then press Verify.</p>
                      <CopyValue label="Type" value="TXT" />
                      <CopyValue label="Name" value={`_adonisagent-verify.${d.host}`} />
                      <CopyValue label="Value" value={d.verifyToken ?? "Press Verify to create it"} />
                      <div className="dm-actions">
                        <Button
                          size="sm"
                          onClick={() =>
                            startTransition(async () => {
                              const res = await verifyDomainAction(siteSlug, d.id);
                              if (res.ok) toast.success("Ownership verified");
                              else toast.error(res.error ?? "Not verified yet");
                              router.refresh();
                            })
                          }
                        >
                          Verify
                        </Button>
                      </div>
                    </>
                  )}
                </Step>

                <Step n={2} title="Point it here" state={d.pointed ? "done" : "todo"}>
                  {d.apex ? (
                    <p className="dm-p">
                      A bare domain usually cannot take this record. Add <strong>www.{d.host}</strong> as its own domain and point
                      that here, then set the registrar to forward {d.host} to https://www.{d.host}.
                    </p>
                  ) : d.pointed ? (
                    <p className="dm-p">The domain points here.</p>
                  ) : (
                    <>
                      <p className="dm-p">Replace the existing record for {sub} with this CNAME. Leave email (MX) records alone.</p>
                      <CopyValue label="Type" value="CNAME" />
                      <CopyValue label="Name" value={sub} />
                      <CopyValue label="Target" value={target} />
                    </>
                  )}
                </Step>

                <Step
                  n={3}
                  title="Secure connection (HTTPS)"
                  state={d.https?.state === "active" ? "done" : d.https?.state === "pending" ? "wait" : "todo"}
                >
                  <p className="dm-p">{d.https ? d.https.detail : "Issued automatically once client domains are switched on and the domain points here."}</p>
                </Step>
              </ol>

              <footer className="dm-foot">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await recheckDomainAction(siteSlug, d.id);
                      if (!res.ok) toast.error(res.error ?? "Couldn't check");
                      router.refresh();
                    })
                  }
                >
                  <RefreshCw size={14} /> Check again
                </Button>
                {!d.isPrimary && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      startTransition(async () => {
                        await makePrimaryAction(siteSlug, d.id);
                        toast.success("Main address set");
                        router.refresh();
                      })
                    }
                  >
                    <Star size={14} /> Make main address
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${d.host}`}
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Remove this domain?",
                      body: `The site stops loading on ${d.host}${d.isPrimary ? ", which is its main address," : ""} until it is added and verified again.`,
                      confirmLabel: "Remove",
                      destructive: true,
                    });
                    if (!ok) return;
                    startTransition(async () => {
                      await removeDomainAction(siteSlug, d.id);
                      router.refresh();
                    });
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </footer>
            </section>
          );
        })
      )}
    </div>
  );
}
