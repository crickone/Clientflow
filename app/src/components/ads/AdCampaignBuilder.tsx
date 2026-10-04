"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
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
  searchInterestsAction,
  listLeadFormsAction,
  resolvePlaceAction,
  suggestPlacesAction,
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

// Leaflet needs window, so the map only ever renders in the browser.
const AudienceMap = dynamic(() => import("./AudienceMap"), {
  ssr: false,
  loading: () => <div style={{ height: 320, borderRadius: "var(--radius)", border: "1px solid var(--hairline)", background: "var(--surface-1)" }} />,
});

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

function blankLeadForm(campaignName: string): NonNullable<CampaignSpec["leadForm"]> {
  return { name: `${campaignName || "Campaign"} form`, headline: "", fields: ["FULL_NAME", "EMAIL", "PHONE"], privacyPolicyUrl: "", thankYouUrl: "" };
}

export function blankSpec(designs: BuilderDesign[]): CampaignSpec {
  // Starts on Leads, so it starts with the instant form a leads campaign
  // needs. It used to start with none, and the form card (shown only when one
  // exists) never appeared while Review demanded it.
  return { name: "", objective: "leads", adSets: [newAdSet(designs, 1)], leadForm: blankLeadForm(""), messageDestination: "messenger" };
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
  initialStep,
}: {
  campaignId: number | null;
  /** Step to open on (from ?step= in the URL), so a refresh lands where you were. */
  initialStep?: number;
  /** null for a new campaign: the blank spec is built here, on the client. */
  initialSpec: CampaignSpec | null;
  initialAdAccountId: string;
  adAccounts: BuilderAdAccount[];
  designs: BuilderDesign[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [spec, setSpec] = useState<CampaignSpec>(() => {
    const s = initialSpec ?? blankSpec(designs);
    // A leads draft saved before it had a form gets a blank one to fill in.
    return s.objective === "leads" && !s.leadForm ? { ...s, leadForm: blankLeadForm(s.name) } : s;
  });
  const [adAccountId, setAdAccountId] = useState(initialAdAccountId);
  const [id, setId] = useState<number | null>(campaignId);
  const [busy, start] = useTransition();
  // One step per screen: Goal, Audience, Budget, Ads, Review. A saved draft
  // reopens on Review, where everything is summarised with Edit links.
  const [step, setStep] = useState(() =>
    initialStep != null && initialStep >= 0 && initialStep < STEPS.length ? initialStep : campaignId ? STEPS.length - 1 : 0,
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const idRef = useRef<number | null>(campaignId);
  const [activeSet, setActiveSet] = useState(0);
  // The Page's existing instant forms (made in Meta), loaded once for Leads.
  const [pageForms, setPageForms] = useState<Array<{ id: string; name: string }> | null>(null);
  useEffect(() => {
    if (spec.objective !== "leads" || pageForms !== null) return;
    void listLeadFormsAction().then((r) => {
      const forms = r.ok ? r.data : [];
      setPageForms(forms);
      // A new campaign on a Page that already has forms starts on "use one".
      setSpec((s) =>
        s.objective === "leads" && s.leadForm && s.leadForm.existingFormId === undefined && !s.leadForm.headline && !s.leadForm.privacyPolicyUrl && forms.length
          ? { ...s, leadForm: { ...s.leadForm, existingFormId: forms[0].id } }
          : s,
      );
    });
  }, [spec.objective, pageForms]);
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
          ? spec.leadForm ?? blankLeadForm(spec.name)
          : null,
    });
  }

  // A refresh reopens the same draft on the same step. The draft is in the URL
  // (set once, when it is first saved); the step is remembered in this browser.
  // The step is deliberately NOT a ?step= search param: Next keys the page on
  // its search params, so changing one remounted the builder from the last
  // saved copy and threw away edits made since (a new ad set, a gender).
  const stepKey = (draftId: number | null) => `ads-builder-step:${draftId ?? "new"}`;
  function rememberStep(draftId: number | null, n: number) {
    try {
      window.localStorage.setItem(stepKey(draftId), String(n));
    } catch {
      // storage blocked: a refresh just opens on the default step
    }
  }
  useEffect(() => {
    if (initialStep != null) return;
    try {
      const saved = Number(window.localStorage.getItem(stepKey(campaignId)));
      if (Number.isInteger(saved) && saved > 0 && saved < STEPS.length) setStep(saved);
    } catch {
      // storage blocked
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  async function save(opts: { quiet?: boolean; urlStep?: number } = {}): Promise<number | null> {
    setSaveState("saving");
    const res = await saveAdDraftAction(idRef.current, adAccountId, spec);
    if (!res.ok) {
      setSaveState("error");
      if (!opts.quiet) toast.error(res.error);
      return null;
    }
    const created = idRef.current == null;
    idRef.current = res.data.id;
    setId(res.data.id);
    setSaveState("saved");
    if (created) {
      // The one navigation: /new -> /<id>, which reloads what was just saved.
      rememberStep(res.data.id, opts.urlStep ?? step);
      router.replace(`/marketing/ads/${res.data.id}`, { scroll: false });
    }
    return res.data.id;
  }

  function onSave() {
    start(async () => {
      if (await save()) toast.success("Draft saved");
    });
  }

  // Autosave: once the draft exists, every change is saved a moment after the
  // last edit. (A new campaign becomes a draft the first time Next is pressed.)
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (idRef.current == null) return;
    const t = setTimeout(() => void save({ quiet: true }), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save reads the latest spec through closure on each run
  }, [spec, adAccountId]);

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
    rememberStep(idRef.current, n);
    window.scrollTo({ top: 0, behavior: "smooth" });
    // Every step change saves at once (no autosave delay). For a new campaign
    // this is when it becomes a draft, so a refresh from here loses nothing.
    if (idRef.current != null || n > 0) void save({ quiet: true, urlStep: n });
  };

  function addAdSet() {
    patch({ adSets: [...spec.adSets, newAdSet(designs, spec.adSets.length + 1)] });
    setActiveSet(spec.adSets.length);
  }

  // The campaign's ad sets, as in Ads Manager: pick one to edit, add another.
  const setTabs = (withAdd: boolean) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
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
      {withAdd && (
        <Button variant="ghost" size="sm" onClick={addAdSet}>
          <Plus size={14} /> Add ad set
        </Button>
      )}
    </div>
  );

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

      {/* ── 1. Campaign ── */}
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
                <Label htmlFor="ad-advertiser">Advertiser name (EU rule: who the ad is for and who paid)</Label>
                <Input id="ad-advertiser" value={spec.advertiser ?? ""} onChange={(e) => patch({ advertiser: e.target.value })} placeholder="Leave blank to use your Facebook Page name" />
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
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[
                  { key: "existing", label: "Use a form from your Page" },
                  { key: "new", label: "Create a new form here" },
                ].map((o) => {
                  const on = (o.key === "existing") === (spec.leadForm?.existingFormId != null);
                  return (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() =>
                        patch({
                          leadForm: { ...spec.leadForm!, existingFormId: o.key === "existing" ? (spec.leadForm!.existingFormId ?? pageForms?.[0]?.id ?? "") : null },
                        })
                      }
                      style={{
                        padding: "7px 14px",
                        borderRadius: 999,
                        border: `1px solid ${on ? "var(--accent)" : "var(--hairline)"}`,
                        background: on ? "var(--accent-soft)" : "transparent",
                        color: on ? "var(--text-primary)" : "var(--text-secondary)",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
              {spec.leadForm.existingFormId != null ? (
                <div style={{ maxWidth: 420 }}>
                  <Label htmlFor="lf-existing">Instant form</Label>
                  {pageForms === null ? (
                    <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Loading your Page&rsquo;s forms…</div>
                  ) : pageForms.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
                      Your Page has no instant forms yet. Make one in Meta, or create one here instead.
                    </div>
                  ) : (
                    <>
                      <select
                        id="lf-existing"
                        style={selectStyle}
                        value={spec.leadForm.existingFormId}
                        onChange={(e) => patch({ leadForm: { ...spec.leadForm!, existingFormId: e.target.value } })}
                      >
                        {!pageForms.some((f) => f.id === spec.leadForm!.existingFormId) && <option value="">Choose a form</option>}
                        {pageForms.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                      <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", marginTop: 6 }}>
                        Its questions, privacy policy and thank-you screen are used exactly as you set them up in Meta.
                      </div>
                    </>
                  )}
                </div>
              ) : (
              <>
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
              </>
              )}
            </Card>
          )}
        </>
      )}

      {/* ── 2. Ad sets: who sees it, budget and schedule (Ads Manager's ad set level) ── */}
      {step === 1 && (
        <>
          <Card style={{ padding: "18px 22px", display: "grid", gap: 12 }}>
            <StepHead
              title="Ad sets"
              hint="An ad set is who sees the ads, how much to spend and when. Most campaigns need one; add another to target a different area or group with its own budget."
            />
            {setTabs(true)}
          </Card>

          <Card key={si} style={{ padding: 22, display: "grid", gap: 18 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 260px", maxWidth: 420 }}>
                <Label htmlFor={`as-name-${si}`}>Ad set name</Label>
                <Input id={`as-name-${si}`} value={set.name} onChange={(e) => patchSet(si, { name: e.target.value })} />
              </div>
              {spec.adSets.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    patch({ adSets: spec.adSets.filter((_, j) => j !== si) });
                    setActiveSet(0);
                  }}
                >
                  <Trash2 size={14} /> Remove this ad set
                </Button>
              )}
            </div>

            <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 12 }}>Audience</div>
              <AudienceEditor key={si} index={si} audience={set.audience} onChange={(p) => patchAudience(si, p)} />
            </div>

            <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16, display: "grid", gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>Budget and schedule</div>
                <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", marginTop: 3 }}>Meta never spends more than the daily budget. Leave the dates blank to start at launch and run until you pause.</div>
              </div>
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
            </div>
          </Card>
        </>
      )}

      {/* ── 3. Ads (per ad set) ── */}
      {step === 2 && (
        <>
          <Card style={{ padding: "18px 22px", display: "grid", gap: 12 }}>
            <StepHead title="Ads" hint="What people see: a Content Studio design plus the words around it. Each ad set has its own ads; add a second ad to let Meta test which works better." />
            {spec.adSets.length > 1 && setTabs(false)}
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

      {/* ── 4. Review ── */}
      {step === 3 && (
        <Card style={{ padding: 22, display: "grid", gap: 18 }}>
          <StepHead title="Check and launch" hint="Nothing goes to Meta until you press Launch. Save it as a draft to come back later." />
          <ReviewRow label="Campaign" onEdit={() => go(0)}>
            {splitLabel(OBJECTIVE_LABEL[spec.objective])[0]}
            {spec.name ? ` · ${spec.name}` : ""}
          </ReviewRow>
          {spec.adSets.map((x, j) => (
            <div key={j} style={{ display: "grid", gap: 10 }}>
              {spec.adSets.length > 1 && <div style={subLabel}>{x.name || `Ad set ${j + 1}`}</div>}
              <ReviewRow label="Audience" onEdit={() => (setActiveSet(j), go(1))}>
                {x.audience.locations.map((l) => (l.kind === "country" ? l.name : `${l.name} + ${l.radiusKm} km`)).join(", ") || "No location"} ·{" "}
                {x.audience.genders.length === 1 ? (x.audience.genders[0] === "female" ? "women" : "men") : "everyone"} aged {x.audience.ageMin}–{x.audience.ageMax === 65 ? "65+" : x.audience.ageMax}
                {x.audience.interests.length ? ` · ${x.audience.interests.length} interest${x.audience.interests.length === 1 ? "" : "s"}` : ""}
              </ReviewRow>
              <ReviewRow label="Budget" onEdit={() => (setActiveSet(j), go(1))}>
                {money(x.dailyBudget, currency)} a day · {x.startAt ? `from ${new Date(x.startAt).toLocaleDateString("en-IE")}` : "starts at launch"} ·{" "}
                {x.endAt ? `until ${new Date(x.endAt).toLocaleDateString("en-IE")}` : "runs until paused"}
              </ReviewRow>
              <ReviewRow label="Ads" onEdit={() => (setActiveSet(j), go(2))}>
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
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span aria-live="polite" style={{ fontSize: 12.5, color: saveState === "error" ? "var(--danger)" : "var(--text-tertiary)", marginRight: 4 }}>
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved" : ""}
          </span>
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

const STEPS = ["Campaign", "Ad sets", "Ads", "Review"] as const;

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
  const [places, setPlaces] = useState<Array<{ name: string; label: string; lat?: number; lng?: number }>>([]);
  const [highlight, setHighlight] = useState(0);
  const [placing, setPlacing] = useState(false);
  const lastQuery = useRef("");

  // Suggestions as you type: 250 ms after the last keystroke, latest query wins.
  useEffect(() => {
    const q = cityQ.trim();
    if (q.length < 2) {
      setPlaces([]);
      return;
    }
    const t = setTimeout(async () => {
      lastQuery.current = q;
      const r = await suggestPlacesAction(q);
      if (lastQuery.current !== q) return;
      setPlaces(r.ok ? r.data : []);
      setHighlight(0);
    }, 250);
    return () => clearTimeout(t);
  }, [cityQ]);

  async function pickPlace(p: { name: string; label: string; lat?: number; lng?: number }) {
    if (p.lat != null && p.lng != null) return addPin(p.lat, p.lng, p.name);
    setPlacing(true);
    const r = await resolvePlaceAction(p.label);
    setPlacing(false);
    if (!r.ok || !r.data) return void toast.error(`Couldn't find ${p.name} on the map. Click the map to drop the pin instead.`);
    addPin(r.data.lat, r.data.lng, p.name);
  }
  const [newRadius, setNewRadius] = useState(10);
  // The pin the radius slider edits (an index into pins); -1 = none yet.
  const [selectedPin, setSelectedPin] = useState(-1);
  const [interestQ, setInterestQ] = useState("");
  const [interests, setInterests] = useState<InterestRef[]>([]);
  const [searching, start] = useTransition();

  function findInterests() {
    start(async () => {
      const r = await searchInterestsAction(interestQ);
      if (!r.ok) return void toast.error(r.error);
      setInterests(r.data.map((i) => ({ id: i.id, name: i.name })));
    });
  }
  const setLocations = (locations: LocationRef[]) => onChange({ locations });
  // A pin replaces the country-wide default: "Ireland" plus a 10 km circle would
  // just be Ireland.
  function addPin(lat: number, lng: number, name: string) {
    const kept = audience.locations.filter((l) => l.kind !== "country");
    setLocations([...kept, { kind: "point", lat, lng, name, radiusKm: newRadius }]);
    setSelectedPin(kept.filter((l) => l.kind === "point").length);
    setPlaces([]);
    setCityQ("");
  }
  const pins = audience.locations
    .filter((l): l is Extract<LocationRef, { kind: "point" }> => l.kind === "point")
    .map((l) => ({ lat: l.lat, lng: l.lng, radiusKm: l.radiusKm, name: l.name }));
  // Default to the newest pin, so a just-added pin is the one being sized.
  const activePin = pins.length ? (selectedPin >= 0 && selectedPin < pins.length ? selectedPin : pins.length - 1) : -1;
  const sliderValue = activePin >= 0 ? pins[activePin].radiusKm : newRadius;
  function setRadius(km: number) {
    setNewRadius(km);
    if (activePin < 0) return;
    let n = -1;
    setLocations(audience.locations.map((l) => (l.kind === "point" && ++n === activePin ? { ...l, radiusKm: km } : l)));
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={subLabel}>Where</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {audience.locations.map((l, j) => (
          <span
            key={j}
            onClick={() => {
              if (l.kind !== "point") return;
              setSelectedPin(audience.locations.slice(0, j).filter((x) => x.kind === "point").length);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 8px",
              border: `1px solid ${l.kind === "point" && audience.locations.slice(0, j).filter((x) => x.kind === "point").length === activePin ? "var(--accent)" : "var(--hairline)"}`,
              borderRadius: 999,
              fontSize: 12.5,
              color: "var(--text-secondary)",
              cursor: l.kind === "point" ? "pointer" : "default",
            }}
          >
            {l.kind === "city" || l.kind === "point" ? (
              <>
                {l.name} +
                <input
                  aria-label={`Radius around ${l.name} in km`}
                  type="number"
                  min={1}
                  max={80}
                  value={l.radiusKm}
                  onChange={(e) => setLocations(audience.locations.map((x, m) => (m === j && (x.kind === "city" || x.kind === "point") ? { ...x, radiusKm: Number(e.target.value) } : x)))}
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
      <div style={{ position: "relative" }}>
        <Input
          aria-label="Search a place"
          role="combobox"
          aria-expanded={places.length > 0}
          aria-controls={`place-list-${index}`}
          aria-autocomplete="list"
          placeholder="Start typing a town or area (e.g. Clonmel)"
          value={cityQ}
          disabled={placing}
          onChange={(e) => setCityQ(e.target.value)}
          onKeyDown={(e) => {
            if (!places.length) return;
            if (e.key === "ArrowDown") (e.preventDefault(), setHighlight((h) => Math.min(places.length - 1, h + 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setHighlight((h) => Math.max(0, h - 1)));
            else if (e.key === "Enter") (e.preventDefault(), void pickPlace(places[highlight]));
            else if (e.key === "Escape") setPlaces([]);
          }}
        />
        {places.length > 0 && (
          <ul
            id={`place-list-${index}`}
            role="listbox"
            style={{
              position: "absolute",
              zIndex: 1000,
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              margin: 0,
              padding: 4,
              listStyle: "none",
              background: "var(--surface-2)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
            }}
          >
            {places.map((p, j) => (
              <li
                key={`${p.label}-${j}`}
                role="option"
                aria-selected={j === highlight}
                onMouseEnter={() => setHighlight(j)}
                onMouseDown={(e) => (e.preventDefault(), void pickPlace(p))}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13.5,
                  background: j === highlight ? "var(--surface-3)" : "transparent",
                  color: "var(--text-primary)",
                }}
              >
                {p.name}
                <span style={{ color: "var(--text-tertiary)" }}>{p.label.slice(p.name.length)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <AudienceMap
        pins={pins}
        selected={activePin}
        onSelect={setSelectedPin}
        onPick={(lat, lng) => addPin(lat, lng, `Pin ${lat.toFixed(3)}, ${lng.toFixed(3)}`)}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 13, color: "var(--text-secondary)" }}>
        <label htmlFor={`radius-${index}`}>{activePin >= 0 ? `Radius around ${pins[activePin].name}` : "Radius"}</label>
        <input id={`radius-${index}`} type="range" min={1} max={80} value={sliderValue} onChange={(e) => setRadius(Number(e.target.value))} style={{ flex: "1 1 160px", maxWidth: 280, accentColor: "var(--accent)" }} />
        <span style={{ minWidth: 48, color: "var(--text-primary)" }}>{sliderValue} km</span>
        <span style={{ color: "var(--text-tertiary)" }}>{placing ? "Finding it on the map…" : pins.length > 1 ? "Click a circle to resize that one." : "Type a place above, or click the map to drop a pin."}</span>
      </div>

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
