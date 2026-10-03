"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Plus, Rocket, Save, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  deleteAdDraftAction,
  launchAdCampaignAction,
  saveAdDraftAction,
  searchCitiesAction,
  searchInterestsAction,
} from "@/app/marketing/ads/actions";
import {
  CTAS,
  OBJECTIVES,
  OBJECTIVE_LABEL,
  totalDailyBudget,
  validateSpec,
  type AdSetSpec,
  type AdSpec,
  type CampaignSpec,
  type Cta,
  type InterestRef,
  type LocationRef,
  type Objective,
} from "@/lib/ads/spec";
import { money } from "./status";

/**
 * Build or edit a draft ad campaign: the campaign, its instant form (leads),
 * its ad sets (budget, dates, audience) and their ads (a Content Studio design
 * plus words). Save keeps a draft; Launch confirms the daily spend and creates
 * everything on Meta. Validation is the same pure rules the server enforces
 * (lib/ads/spec), so the list of what is missing matches what launch checks.
 */

export interface BuilderAdAccount {
  adAccountId: string;
  name: string | null;
  currency: string | null;
}

export interface BuilderDesign {
  id: number;
  name: string;
  slideCount: number;
}

const CTA_LABEL: Record<Cta, string> = {
  LEARN_MORE: "Learn more",
  BOOK_NOW: "Book now",
  SIGN_UP: "Sign up",
  CONTACT_US: "Contact us",
  GET_OFFER: "Get offer",
  SHOP_NOW: "Shop now",
  MESSAGE_PAGE: "Send message",
  APPLY_NOW: "Apply now",
  SUBSCRIBE: "Subscribe",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  height: 40,
  padding: "0 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 13,
};

const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 };

function newAd(designs: BuilderDesign[], n: number): AdSpec {
  return {
    name: `Ad ${n}`,
    creative: { designId: designs[0]?.id ?? 0, format: "single", primaryText: "", headline: "", cta: "LEARN_MORE", linkUrl: "" },
  };
}

function newAdSet(designs: BuilderDesign[], n: number): AdSetSpec {
  return {
    name: `Ad set ${n}`,
    dailyBudget: 10,
    startAt: null,
    endAt: null,
    audience: { locations: [{ kind: "country", code: "IE", name: "Ireland" }], ageMin: 18, ageMax: 65, genders: [], interests: [], advantageAudience: true },
    ads: [newAd(designs, 1)],
  };
}

export function blankSpec(designs: BuilderDesign[]): CampaignSpec {
  return { name: "", objective: "leads", adSets: [newAdSet(designs, 1)], leadForm: null, messageDestination: "messenger" };
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AdCampaignBuilder({
  campaignId,
  initialSpec,
  initialAdAccountId,
  adAccounts,
  designs,
}: {
  campaignId: number | null;
  /** null for a new campaign: the blank spec is built here, on the client. */
  initialSpec: CampaignSpec | null;
  initialAdAccountId: string;
  adAccounts: BuilderAdAccount[];
  designs: BuilderDesign[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [spec, setSpec] = useState<CampaignSpec>(() => initialSpec ?? blankSpec(designs));
  const [adAccountId, setAdAccountId] = useState(initialAdAccountId);
  const [id, setId] = useState<number | null>(campaignId);
  const [busy, start] = useTransition();
  // One step per screen: Goal, Audience, Budget, Ads, Review. A saved draft
  // reopens on Review, where everything is summarised with Edit links.
  const [step, setStep] = useState(campaignId ? 4 : 0);
  const [activeSet, setActiveSet] = useState(0);
  const currency = adAccounts.find((a) => a.adAccountId === adAccountId)?.currency ?? "EUR";
  const problems = validateSpec(spec);

  const patch = (p: Partial<CampaignSpec>) => setSpec((s) => ({ ...s, ...p }));
  const patchSet = (i: number, p: Partial<AdSetSpec>) =>
    setSpec((s) => ({ ...s, adSets: s.adSets.map((x, j) => (j === i ? { ...x, ...p } : x)) }));
  const patchAudience = (i: number, p: Partial<AdSetSpec["audience"]>) =>
    setSpec((s) => ({ ...s, adSets: s.adSets.map((x, j) => (j === i ? { ...x, audience: { ...x.audience, ...p } } : x)) }));
  const patchAd = (i: number, k: number, p: Partial<AdSpec["creative"]> & { name?: string }) =>
    setSpec((s) => ({
      ...s,
      adSets: s.adSets.map((x, j) =>
        j !== i
          ? x
          : {
              ...x,
              ads: x.ads.map((a, m) => {
                if (m !== k) return a;
                const { name, ...creative } = p;
                return { name: name ?? a.name, creative: { ...a.creative, ...creative } };
              }),
            },
      ),
    }));

  function setObjective(objective: Objective) {
    patch({
      objective,
      leadForm:
        objective === "leads"
          ? spec.leadForm ?? { name: `${spec.name || "Campaign"} form`, headline: "", fields: ["FULL_NAME", "EMAIL", "PHONE"], privacyPolicyUrl: "", thankYouUrl: "" }
          : null,
    });
  }

  async function save(): Promise<number | null> {
    const res = await saveAdDraftAction(id, adAccountId, spec);
    if (!res.ok) {
      toast.error(res.error);
      return null;
    }
    setId(res.data.id);
    return res.data.id;
  }

  function onSave() {
    start(async () => {
      const saved = await save();
      if (saved) {
        toast.success("Draft saved");
        if (!id) router.replace(`/marketing/ads/${saved}`);
      }
    });
  }

  async function onLaunch() {
    const total = totalDailyBudget(spec);
    const ok = await confirm({
      title: "Launch this campaign?",
      body: `It goes live on Facebook and Instagram straight away and spends up to ${money(total, currency)} a day from your ad account until you pause it${spec.adSets.some((s) => s.endAt) ? " or its end date passes" : ""}. Meta bills your ad account directly.`,
      confirmLabel: `Launch at ${money(total, currency)} a day`,
    });
    if (!ok) return;
    start(async () => {
      const saved = await save();
      if (!saved) return;
      const res = await launchAdCampaignAction(saved);
      if (!res.ok) {
        toast.error(res.error);
        router.refresh();
        return;
      }
      toast.success("Campaign launched");
      router.replace(`/marketing/ads/${saved}`);
      router.refresh();
    });
  }

  async function onDelete() {
    if (!id) return router.push("/marketing/ads");
    const ok = await confirm({ title: "Delete this draft?", body: "It has not been launched, so nothing changes on Facebook.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    start(async () => {
      const res = await deleteAdDraftAction(id);
      if (!res.ok) return void toast.error(res.error);
      router.push("/marketing/ads");
    });
  }

  const set = spec.adSets[Math.min(activeSet, spec.adSets.length - 1)];
  const si = spec.adSets.indexOf(set);
  const designName = (id: number) => designs.find((d) => d.id === id)?.name ?? "No design chosen";
  const go = (n: number) => {
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Ad set switcher for the per-ad-set steps. Hidden when there is only one.
  const setTabs =
    spec.adSets.length > 1 ? (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {spec.adSets.map((x, j) => (
          <button
            key={j}
            type="button"
            onClick={() => setActiveSet(j)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: `1px solid ${j === si ? "var(--accent)" : "var(--hairline)"}`,
              background: j === si ? "var(--accent-soft)" : "transparent",
              color: j === si ? "var(--text-primary)" : "var(--text-secondary)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {x.name || `Ad set ${j + 1}`}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── Step bar ── */}
      <nav aria-label="Campaign steps" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {STEPS.map((label, n) => {
          const active = n === step;
          const done = n < step;
          return (
            <button
              key={label}
              type="button"
              onClick={() => go(n)}
              aria-current={active ? "step" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: "var(--radius)",
                border: "none",
                background: active ? "var(--surface-2)" : "transparent",
                color: active ? "var(--text-primary)" : "var(--text-tertiary)",
                fontSize: 13.5,
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  background: active || done ? "var(--accent)" : "transparent",
                  color: active || done ? "var(--accent-contrast)" : "var(--text-tertiary)",
                  border: active || done ? "none" : "1px solid var(--hairline)",
                }}
              >
                {done ? <Check size={12} strokeWidth={3} /> : n + 1}
              </span>
              {label}
            </button>
          );
        })}
      </nav>

      {/* ── 1. Goal ── */}
      {step === 0 && (
        <>
          <Card style={{ padding: 22, display: "grid", gap: 18 }}>
            <StepHead title="What should these ads do?" hint="Pick one goal. Meta shows the ads to the people most likely to do it." />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
              {OBJECTIVES.map((o) => {
                const [title, desc] = splitLabel(OBJECTIVE_LABEL[o]);
                const on = spec.objective === o;
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setObjective(o)}
                    style={{
                      textAlign: "left",
                      padding: 14,
                      borderRadius: "var(--radius)",
                      border: `1px solid ${on ? "var(--accent)" : "var(--hairline)"}`,
                      background: on ? "var(--accent-soft)" : "transparent",
                      cursor: "pointer",
                      display: "grid",
                      gap: 3,
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{title}</span>
                    <span style={{ fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.45 }}>{desc}</span>
                  </button>
                );
              })}
            </div>
            {spec.objective === "messages" && (
              <div style={{ maxWidth: 320 }}>
                <Label htmlFor="ad-dest">Open a chat in</Label>
                <select id="ad-dest" style={selectStyle} value={spec.messageDestination ?? "messenger"} onChange={(e) => patch({ messageDestination: e.target.value as "messenger" | "instagram" })}>
                  <option value="messenger">Messenger</option>
                  <option value="instagram">Instagram</option>
                </select>
              </div>
            )}
            <div style={grid2}>
              <div>
                <Label htmlFor="ad-name">Campaign name (only you see it)</Label>
                <Input id="ad-name" value={spec.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Autumn intro offer" />
              </div>
              <div>
                <Label htmlFor="ad-account">Ad account (Meta bills this)</Label>
                <select id="ad-account" style={selectStyle} value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)}>
                  {adAccounts.map((a) => (
                    <option key={a.adAccountId} value={a.adAccountId}>
                      {a.name ?? a.adAccountId} {a.currency ? `(${a.currency})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          {spec.objective === "leads" && spec.leadForm && (
            <Card style={{ padding: 22, display: "grid", gap: 14 }}>
              <StepHead title="Instant form" hint="People fill this in without leaving Facebook or Instagram. Each one lands in Leads straight away." />
              <div style={grid2}>
                <div>
                  <Label htmlFor="lf-head">Intro line</Label>
                  <Input id="lf-head" value={spec.leadForm.headline} placeholder="e.g. Leave your details and we will call you" onChange={(e) => patch({ leadForm: { ...spec.leadForm!, headline: e.target.value } })} />
                </div>
                <div>
                  <Label htmlFor="lf-name">Form name (only you see it)</Label>
                  <Input id="lf-name" value={spec.leadForm.name} onChange={(e) => patch({ leadForm: { ...spec.leadForm!, name: e.target.value } })} />
                </div>
                <div>
                  <Label htmlFor="lf-priv">Your privacy policy link</Label>
                  <Input id="lf-priv" value={spec.leadForm.privacyPolicyUrl} placeholder="https://yoursite.ie/privacy" onChange={(e) => patch({ leadForm: { ...spec.leadForm!, privacyPolicyUrl: e.target.value } })} />
                </div>
                <div>
                  <Label htmlFor="lf-ty">Website link after they submit</Label>
                  <Input id="lf-ty" value={spec.leadForm.thankYouUrl} placeholder="https://yoursite.ie" onChange={(e) => patch({ leadForm: { ...spec.leadForm!, thankYouUrl: e.target.value } })} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", marginBottom: 6 }}>Ask for</div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13.5 }}>
                  {(["FULL_NAME", "EMAIL", "PHONE"] as const).map((f) => (
                    <label key={f} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-secondary)" }}>
                      <input
                        type="checkbox"
                        checked={spec.leadForm!.fields.includes(f)}
                        onChange={(e) => {
                          const fields = e.target.checked ? [...spec.leadForm!.fields, f] : spec.leadForm!.fields.filter((x) => x !== f);
                          patch({ leadForm: { ...spec.leadForm!, fields } });
                        }}
                      />
                      {f === "FULL_NAME" ? "Name" : f === "EMAIL" ? "Email" : "Phone"}
                    </label>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── 2. Audience ── */}
      {step === 1 && (
        <Card style={{ padding: 22, display: "grid", gap: 16 }}>
          <StepHead title="Who should see the ads?" hint="Where they live, their age, and optionally what they are into." />
          {setTabs}
          <AudienceEditor key={si} index={si} audience={set.audience} onChange={(p) => patchAudience(si, p)} />
        </Card>
      )}

      {/* ── 3. Budget & schedule ── */}
      {step === 2 && (
        <Card style={{ padding: 22, display: "grid", gap: 16 }}>
          <StepHead title="How much, and for how long?" hint="Meta never spends more than the daily budget. Leave the dates blank to start at launch and run until you pause." />
          {setTabs}
          <div style={grid2}>
            <div>
              <Label htmlFor={`as-budget-${si}`}>Daily budget ({currency})</Label>
              <Input id={`as-budget-${si}`} type="number" min={1} step={1} value={String(set.dailyBudget)} onChange={(e) => patchSet(si, { dailyBudget: Number(e.target.value) })} />
            </div>
            <div>
              <Label htmlFor={`as-start-${si}`}>Start (blank = at launch)</Label>
              <Input id={`as-start-${si}`} type="datetime-local" value={toLocalInput(set.startAt)} onChange={(e) => patchSet(si, { startAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </div>
            <div>
              <Label htmlFor={`as-end-${si}`}>End (blank = until paused)</Label>
              <Input id={`as-end-${si}`} type="datetime-local" value={toLocalInput(set.endAt)} onChange={(e) => patchSet(si, { endAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </div>
          </div>
          <details style={{ borderTop: "1px solid var(--hairline)", paddingTop: 14 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>Advanced: split into ad sets</summary>
            <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
              <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
                Each ad set has its own audience, budget and ads, for example one per town. Most campaigns need just one.
              </div>
              <div style={{ maxWidth: 360 }}>
                <Label htmlFor={`as-name-${si}`}>This ad set&rsquo;s name</Label>
                <Input id={`as-name-${si}`} value={set.name} onChange={(e) => patchSet(si, { name: e.target.value })} />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    patch({ adSets: [...spec.adSets, newAdSet(designs, spec.adSets.length + 1)] });
                    setActiveSet(spec.adSets.length);
                  }}
                >
                  <Plus size={14} /> Add an ad set
                </Button>
                {spec.adSets.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      patch({ adSets: spec.adSets.filter((_, j) => j !== si) });
                      setActiveSet(0);
                    }}
                  >
                    <Trash2 size={14} /> Remove {set.name || "this ad set"}
                  </Button>
                )}
              </div>
            </div>
          </details>
        </Card>
      )}

      {/* ── 4. Ads ── */}
      {step === 3 && (
        <>
          <Card style={{ padding: "18px 22px", display: "grid", gap: 12 }}>
            <StepHead title="What the ads say" hint="A Content Studio design plus the words around it. Add a second ad to let Meta test which works better." />
            {setTabs}
          </Card>
          {set.ads.map((ad, k) => (
            <Card key={`${si}-${k}`} style={{ padding: 22, display: "grid", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{ad.name || `Ad ${k + 1}`}</span>
                {set.ads.length > 1 && (
                  <Button variant="ghost" size="sm" style={{ marginLeft: "auto" }} onClick={() => patchSet(si, { ads: set.ads.filter((_, m) => m !== k) })}>
                    <X size={14} /> Remove
                  </Button>
                )}
              </div>

              <div style={subLabel}>Picture</div>
              <div style={grid2}>
                <div>
                  <Label htmlFor={`ad-d-${si}-${k}`}>Content Studio design</Label>
                  <select id={`ad-d-${si}-${k}`} style={selectStyle} value={ad.creative.designId} onChange={(e) => patchAd(si, k, { designId: Number(e.target.value) })}>
                    {designs.length === 0 && <option value={0}>No designs yet: make one in Content Studio</option>}
                    {designs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.slideCount} {d.slideCount === 1 ? "image" : "images"})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor={`ad-f-${si}-${k}`}>Format</Label>
                  <select id={`ad-f-${si}-${k}`} style={selectStyle} value={ad.creative.format} onChange={(e) => patchAd(si, k, { format: e.target.value as "single" | "carousel" })}>
                    <option value="single">Single image (first slide)</option>
                    <option value="carousel">Carousel (every slide)</option>
                  </select>
                </div>
              </div>

              <div style={subLabel}>Words</div>
              <div>
                <Label htmlFor={`ad-t-${si}-${k}`}>Main text (above the picture)</Label>
                <Textarea id={`ad-t-${si}-${k}`} rows={3} value={ad.creative.primaryText} onChange={(e) => patchAd(si, k, { primaryText: e.target.value })} />
              </div>
              <div style={grid2}>
                <div>
                  <Label htmlFor={`ad-h-${si}-${k}`}>Headline (below the picture)</Label>
                  <Input id={`ad-h-${si}-${k}`} value={ad.creative.headline} onChange={(e) => patchAd(si, k, { headline: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor={`ad-ds-${si}-${k}`}>Description (optional)</Label>
                  <Input id={`ad-ds-${si}-${k}`} value={ad.creative.description ?? ""} onChange={(e) => patchAd(si, k, { description: e.target.value })} />
                </div>
              </div>

              <div style={subLabel}>Button</div>
              <div style={grid2}>
                <div>
                  <Label htmlFor={`ad-c-${si}-${k}`}>Button text</Label>
                  <select id={`ad-c-${si}-${k}`} style={selectStyle} value={ad.creative.cta} onChange={(e) => patchAd(si, k, { cta: e.target.value as Cta })} disabled={spec.objective === "messages"}>
                    {CTAS.map((c) => (
                      <option key={c} value={c}>
                        {CTA_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </div>
                {spec.objective !== "messages" && (
                  <div>
                    <Label htmlFor={`ad-l-${si}-${k}`}>Website link{spec.objective === "leads" ? " (optional)" : ""}</Label>
                    <Input id={`ad-l-${si}-${k}`} value={ad.creative.linkUrl ?? ""} placeholder="https://" onChange={(e) => patchAd(si, k, { linkUrl: e.target.value })} />
                  </div>
                )}
              </div>
              <details>
                <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--text-tertiary)" }}>Rename this ad</summary>
                <div style={{ maxWidth: 360, marginTop: 8 }}>
                  <Input aria-label="Ad name" value={ad.name} onChange={(e) => patchAd(si, k, { name: e.target.value })} />
                </div>
              </details>
            </Card>
          ))}
          <div>
            <Button variant="outline" size="sm" onClick={() => patchSet(si, { ads: [...set.ads, newAd(designs, set.ads.length + 1)] })}>
              <Plus size={14} /> Add another ad
            </Button>
          </div>
        </>
      )}

      {/* ── 5. Review ── */}
      {step === 4 && (
        <Card style={{ padding: 22, display: "grid", gap: 18 }}>
          <StepHead title="Check and launch" hint="Nothing goes to Meta until you press Launch. Save it as a draft to come back later." />
          <ReviewRow label="Goal" onEdit={() => go(0)}>
            {splitLabel(OBJECTIVE_LABEL[spec.objective])[0]}
            {spec.name ? ` · ${spec.name}` : ""}
          </ReviewRow>
          {spec.adSets.map((x, j) => (
            <div key={j} style={{ display: "grid", gap: 10 }}>
              {spec.adSets.length > 1 && <div style={subLabel}>{x.name || `Ad set ${j + 1}`}</div>}
              <ReviewRow label="Audience" onEdit={() => (setActiveSet(j), go(1))}>
                {x.audience.locations.map((l) => l.name).join(", ") || "No location"} · ages {x.audience.ageMin}–{x.audience.ageMax === 65 ? "65+" : x.audience.ageMax}
                {x.audience.interests.length ? ` · ${x.audience.interests.length} interest${x.audience.interests.length === 1 ? "" : "s"}` : ""}
              </ReviewRow>
              <ReviewRow label="Budget" onEdit={() => (setActiveSet(j), go(2))}>
                {money(x.dailyBudget, currency)} a day · {x.startAt ? `from ${new Date(x.startAt).toLocaleDateString("en-IE")}` : "starts at launch"} ·{" "}
                {x.endAt ? `until ${new Date(x.endAt).toLocaleDateString("en-IE")}` : "runs until paused"}
              </ReviewRow>
              <ReviewRow label="Ads" onEdit={() => (setActiveSet(j), go(3))}>
                {x.ads.map((a) => `${designName(a.creative.designId)}${a.creative.headline ? `: "${a.creative.headline}"` : ""}`).join(" · ")}
              </ReviewRow>
            </div>
          ))}
          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 15, color: "var(--text-primary)" }}>
                Up to <strong>{money(totalDailyBudget(spec), currency)}</strong> a day
              </span>
              {problems.length === 0 ? <Badge tone="success">Ready to launch</Badge> : <Badge tone="warning">{problems.length} to fix</Badge>}
            </div>
            {problems.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text-secondary)", display: "grid", gap: 4 }}>
                {problems.slice(0, 8).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}

      {/* ── Footer ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {step > 0 && (
          <Button variant="ghost" onClick={() => go(step - 1)} disabled={busy}>
            <ArrowLeft size={15} /> Back
          </Button>
        )}
        <Button variant="ghost" onClick={onDelete} disabled={busy}>
          <Trash2 size={15} /> {id ? "Delete draft" : "Cancel"}
        </Button>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Button variant="outline" onClick={onSave} disabled={busy}>
            <Save size={15} /> Save draft
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => go(step + 1)}>
              Next: {STEPS[step + 1]} <ArrowRight size={15} />
            </Button>
          ) : (
            <Button onClick={onLaunch} disabled={busy || problems.length > 0}>
              <Rocket size={15} /> Launch
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}

const STEPS = ["Goal", "Audience", "Budget", "Ads", "Review"] as const;

const subLabel: React.CSSProperties = { fontSize: 11.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)" };

/** "Leads (an instant form; ...)" -> ["Leads", "An instant form; ..."] */
function splitLabel(label: string): [string, string] {
  const m = label.match(/^([^(]+)\((.*)\)$/);
  if (!m) return [label, ""];
  const desc = m[2].trim();
  return [m[1].trim(), desc.charAt(0).toUpperCase() + desc.slice(1)];
}

function StepHead({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <div style={{ fontSize: 17, fontWeight: 600, color: "var(--text-primary)" }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--text-tertiary)", marginTop: 4, lineHeight: 1.5 }}>{hint}</div>
    </div>
  );
}

function ReviewRow({ label, onEdit, children }: { label: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "96px 1fr auto", gap: 12, alignItems: "baseline" }}>
      <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>{label}</span>
      <span style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.5 }}>{children}</span>
      <Button variant="ghost" size="sm" onClick={onEdit}>
        Edit
      </Button>
    </div>
  );
}

// ── Audience ──────────────────────────────────────────────────────────────

function AudienceEditor({
  index,
  audience,
  onChange,
}: {
  index: number;
  audience: AdSetSpec["audience"];
  onChange: (p: Partial<AdSetSpec["audience"]>) => void;
}) {
  const [cityQ, setCityQ] = useState("");
  const [cities, setCities] = useState<Array<{ key: string; name: string; region: string | null }>>([]);
  const [interestQ, setInterestQ] = useState("");
  const [interests, setInterests] = useState<InterestRef[]>([]);
  const [searching, start] = useTransition();

  function findCities() {
    start(async () => {
      const r = await searchCitiesAction(cityQ);
      if (!r.ok) return void toast.error(r.error);
      setCities(r.data);
    });
  }
  function findInterests() {
    start(async () => {
      const r = await searchInterestsAction(interestQ);
      if (!r.ok) return void toast.error(r.error);
      setInterests(r.data.map((i) => ({ id: i.id, name: i.name })));
    });
  }
  const setLocations = (locations: LocationRef[]) => onChange({ locations });

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={subLabel}>Where</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {audience.locations.map((l, j) => (
          <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", border: "1px solid var(--hairline)", borderRadius: 999, fontSize: 12.5, color: "var(--text-secondary)" }}>
            {l.kind === "city" ? (
              <>
                {l.name} +
                <input
                  aria-label={`Radius around ${l.name} in km`}
                  type="number"
                  min={1}
                  max={80}
                  value={l.radiusKm}
                  onChange={(e) => setLocations(audience.locations.map((x, m) => (m === j && x.kind === "city" ? { ...x, radiusKm: Number(e.target.value) } : x)))}
                  style={{ width: 46, background: "transparent", border: "none", color: "var(--text-primary)", fontSize: 12.5 }}
                />
                km
              </>
            ) : (
              l.name
            )}
            <button type="button" aria-label="Remove location" onClick={() => setLocations(audience.locations.filter((_, m) => m !== j))} style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", display: "flex" }}>
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Input aria-label="Search a town or city" placeholder="Add a town or city (e.g. Clonmel)" value={cityQ} onChange={(e) => setCityQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), findCities())} />
        <Button variant="outline" onClick={findCities} disabled={searching || !cityQ.trim()}>
          <Search size={14} />
        </Button>
      </div>
      {cities.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {cities.map((c) => (
            <Button
              key={c.key}
              size="sm"
              variant="outline"
              onClick={() => {
                const withoutCountry = audience.locations.filter((l) => l.kind === "city");
                setLocations([...withoutCountry, { kind: "city", key: c.key, name: c.name, radiusKm: 25 }]);
                setCities([]);
                setCityQ("");
              }}
            >
              {c.name}
              {c.region ? `, ${c.region}` : ""}
            </Button>
          ))}
        </div>
      )}

      <div style={{ ...subLabel, marginTop: 8 }}>Age and gender</div>
      <div style={grid2}>
        <div>
          <Label htmlFor={`age-min-${index}`}>Youngest age</Label>
          <Input id={`age-min-${index}`} type="number" min={18} max={65} value={String(audience.ageMin)} onChange={(e) => onChange({ ageMin: Number(e.target.value) })} />
        </div>
        <div>
          <Label htmlFor={`age-max-${index}`}>Oldest age (65 = 65+)</Label>
          <Input id={`age-max-${index}`} type="number" min={18} max={65} value={String(audience.ageMax)} onChange={(e) => onChange({ ageMax: Number(e.target.value) })} />
        </div>
        <div>
          <Label htmlFor={`gender-${index}`}>Gender</Label>
          <select
            id={`gender-${index}`}
            style={selectStyle}
            value={audience.genders.length === 1 ? audience.genders[0] : "all"}
            onChange={(e) => onChange({ genders: e.target.value === "all" ? [] : [e.target.value as "male" | "female"] })}
          >
            <option value="all">Everyone</option>
            <option value="female">Women</option>
            <option value="male">Men</option>
          </select>
        </div>
      </div>

      <div style={{ ...subLabel, marginTop: 8 }}>Interests (optional)</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {audience.interests.map((it) => (
          <Badge key={it.id}>
            {it.name}
            <button type="button" aria-label={`Remove ${it.name}`} onClick={() => onChange({ interests: audience.interests.filter((x) => x.id !== it.id) })} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", marginLeft: 4, display: "inline-flex" }}>
              <X size={11} />
            </button>
          </Badge>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Input aria-label="Search interests" placeholder="Add an interest (e.g. yoga, physiotherapy)" value={interestQ} onChange={(e) => setInterestQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), findInterests())} />
        <Button variant="outline" onClick={findInterests} disabled={searching || !interestQ.trim()}>
          <Search size={14} />
        </Button>
      </div>
      {interests.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {interests.map((it) => (
            <Button
              key={it.id}
              size="sm"
              variant="outline"
              onClick={() => {
                if (!audience.interests.some((x) => x.id === it.id)) onChange({ interests: [...audience.interests, it] });
              }}
            >
              <Plus size={12} /> {it.name}
            </Button>
          ))}
        </div>
      )}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
        <input type="checkbox" checked={audience.advantageAudience} onChange={(e) => onChange({ advantageAudience: e.target.checked })} />
        Let Meta show it to people beyond these interests when it expects better results (Advantage+ audience)
      </label>
    </div>
  );
}
