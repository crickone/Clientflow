"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Plus, Rocket, Save, Search, Trash2, Upload, X } from "lucide-react";
import { AdPreview } from "./builder/AdPreview";
import { AgeRange, BudgetStepper, DateChoice, ObjectiveCards, Segmented } from "./builder/controls";
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
  textOptions,
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

export interface BuilderPhoto {
  id: number;
  filename: string;
  name: string;
}

/** A finished Content Studio video ad. */
export interface BuilderVideoAd {
  id: number;
  name: string;
  /** The 9:16 render, for the picker. */
  videoUrl: string;
}

export interface BuilderDesign {
  id: number;
  name: string;
  slideCount: number;
  /** Rendered slide image URLs, for the picker and the live preview. */
  images: string[];
}

/** The Page identity the live preview shows. */
export interface BuilderBrand {
  pageName: string;
  instagramHandle: string | null;
  logoUrl: string | null;
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
    audience: { locations: [{ kind: "country", code: "IE", name: "Ireland" }], ageMin: 18, ageMax: 65, genders: [], interests: [], advantageAudience: false },
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
  photos: initialPhotos = [],
  brand = null,
  initialStep,
  videoAds = [],
}: {
  campaignId: number | null;
  /** Step to open on (from ?step= in the URL), so a refresh lands where you were. */
  initialStep?: number;
  /** null for a new campaign: the blank spec is built here, on the client. */
  initialSpec: CampaignSpec | null;
  initialAdAccountId: string;
  adAccounts: BuilderAdAccount[];
  designs: BuilderDesign[];
  /** Photos in the Content Studio library, for ads that use the business's own pictures. */
  photos?: BuilderPhoto[];
  brand?: BuilderBrand | null;
  /** Finished video ads from Content Studio. */
  videoAds?: BuilderVideoAd[];
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
  const [photos, setPhotos] = useState<BuilderPhoto[]>(initialPhotos);
  const [uploading, setUploading] = useState(false);

  // Upload into the Content Studio library (so the photo can be reused), then
  // add it to this ad's pictures.
  async function uploadPhotos(i: number, k: number, files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("file", f);
      const res = await fetch("/api/content-studio/image-library", { method: "POST", body: form });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; assets?: Array<{ id: number; filename: string; originalName?: string | null; kind?: string | null }> } | null;
      if (!res.ok || !d?.ok) return void toast.error(d?.error ?? "Upload failed.");
      const added = (d.assets ?? []).filter((a) => a.kind !== "video" && a.kind !== "file").map((a) => ({ id: a.id, filename: a.filename, name: a.originalName || `Photo ${a.id}` }));
      if (!added.length) return void toast.error("Upload photos (JPEG, PNG or WebP). Video ads are coming next.");
      setPhotos((p) => [...added, ...p]);
      const current = spec.adSets[i]?.ads[k]?.creative.imageAssetIds ?? [];
      patchAd(i, k, { source: "library", imageAssetIds: [...current, ...added.map((a) => a.id)].slice(0, 10) });
    } finally {
      setUploading(false);
    }
  }
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
    // Only a saved draft has a step to come back to. A shared "new" slot made
    // every new campaign open on whatever step the last one reached.
    if (draftId == null) return;
    try {
      window.localStorage.setItem(stepKey(draftId), String(n));
    } catch {
      // storage blocked: a refresh just opens on the default step
    }
  }
  useEffect(() => {
    if (initialStep != null || campaignId == null) return;
    try {
      window.localStorage.removeItem(stepKey(null)); // leftovers from before this fix
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
      router.replace(`/marketing/ads/${saved}?launched=1`);
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

  const [activeAd, setActiveAd] = useState(0);
  const ad = set.ads[Math.min(activeAd, set.ads.length - 1)] ?? set.ads[0];
  const objectiveOptions = OBJECTIVES.map((o) => {
    const [title, desc] = splitLabel(OBJECTIVE_LABEL[o]);
    return { key: o, title, desc };
  });

  // What the preview shows: the ad being edited, with its real pictures.
  const imagesFor = (c: AdSpec["creative"]): string[] => {
    if (c.source === "video") return [];
    if (c.source === "library") {
      return (c.imageAssetIds ?? [])
        .map((pid) => photos.find((p) => p.id === pid))
        .filter((p): p is BuilderPhoto => !!p)
        .map((p) => `/api/content-studio/image-library/file/${encodeURIComponent(p.filename)}`);
    }
    const imgs = designs.find((d) => d.id === c.designId)?.images ?? [];
    return c.format === "single" ? imgs.slice(0, 1) : imgs;
  };
  const hostOf = (url?: string) => {
    try {
      return url ? new URL(url).host.replace(/^www\./, "") : null;
    } catch {
      return null;
    }
  };
  // Which version the preview shows, when the ad has text or image options.
  const [pv, setPv] = useState(0);
  const pvTexts = ad ? textOptions(ad.creative) : { texts: [], headlines: [] };
  const pvImages = ad ? imagesFor(ad.creative) : [];
  const pvOptionImages = ad?.creative.format === "options" && pvImages.length > 1 ? pvImages : [];
  const pvCount = Math.max(1, pvTexts.texts.length, pvTexts.headlines.length, pvOptionImages.length);
  const pvi = pv % pvCount;
  const previewAd = ad
    ? {
        pageName: brand?.pageName ?? "Your Page",
        instagramHandle: brand?.instagramHandle ?? null,
        logoUrl: brand?.logoUrl ?? null,
        primaryText: pvTexts.texts.length ? pvTexts.texts[pvi % pvTexts.texts.length] : ad.creative.primaryText,
        headline: pvTexts.headlines.length ? pvTexts.headlines[pvi % pvTexts.headlines.length] : ad.creative.headline,
        description: ad.creative.description,
        ctaLabel: spec.objective === "messages" ? "Send message" : CTA_LABEL[ad.creative.cta],
        images: pvOptionImages.length ? [pvOptionImages[pvi % pvOptionImages.length]] : pvImages,
        linkHost: spec.objective === "leads" || spec.objective === "messages" ? null : hostOf(ad.creative.linkUrl),
      }
    : null;

  const whereOf = (x: AdSetSpec) => {
    const places = x.audience.locations.map((l) => (l.kind === "country" ? l.name : `${l.name} + ${l.radiusKm} km`)).join(", ") || "Nowhere yet";
    const who = x.audience.genders.length === 1 ? (x.audience.genders[0] === "female" ? "Women" : "Men") : "Everyone";
    return `${places} · ${who} ${x.audience.ageMin}–${x.audience.ageMax >= 65 ? "65+" : x.audience.ageMax}`;
  };
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
  const runsOf = (x: AdSetSpec) =>
    `${x.startAt ? `Starts ${day(x.startAt)}` : "Starts at launch"}, ${x.endAt ? `ends ${day(x.endAt)}` : "runs until paused"}`;
  const adCount = spec.adSets.reduce((n, x) => n + x.ads.length, 0);

  // ── The rail: live preview + the plan so far ──
  const rail = (
    <aside className="adb-rail" aria-label="Preview and plan">
      {previewAd && (
        <div className="adb-rail-card">
          <div className="adb-rail-label">
            Preview{spec.adSets.length > 1 || set.ads.length > 1 ? ` · ${set.name || `Ad set ${si + 1}`}, ${ad.name || `Ad ${activeAd + 1}`}` : ""}
          </div>
          {pvCount > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 12.5, color: "var(--text-secondary)" }}>
              <button type="button" className="adb-budget-btn" style={{ width: 28, height: 28 }} aria-label="Previous version" onClick={() => setPv((pvi + pvCount - 1) % pvCount)}>
                <ArrowLeft size={13} />
              </button>
              Version {pvi + 1} of {pvCount}
              <button type="button" className="adb-budget-btn" style={{ width: 28, height: 28 }} aria-label="Next version" onClick={() => setPv((pvi + 1) % pvCount)}>
                <ArrowRight size={13} />
              </button>
            </div>
          )}
          <AdPreview ad={previewAd} />
        </div>
      )}
      <div className="adb-rail-card">
        <div className="adb-rail-label">Your plan</div>
        <dl className="adb-plan">
          <div className="adb-plan-row">
            <dt>Goal</dt>
            <dd>{splitLabel(OBJECTIVE_LABEL[spec.objective])[0]}</dd>
            <button type="button" className="adb-plan-edit" onClick={() => go(0)}>Edit</button>
          </div>
          {spec.adSets.map((x, j) => (
            <div className="adb-plan-row" key={j}>
              <dt>{spec.adSets.length > 1 ? x.name || `Ad set ${j + 1}` : "Who"}</dt>
              <dd>
                {whereOf(x)}
                <br />
                <span style={{ color: "var(--text-tertiary)" }}>{money(x.dailyBudget, currency)} a day · {runsOf(x)}</span>
              </dd>
              <button type="button" className="adb-plan-edit" onClick={() => (setActiveSet(j), go(1))}>Edit</button>
            </div>
          ))}
          <div className="adb-plan-row">
            <dt>Ads</dt>
            <dd>{adCount === 1 ? "1 ad" : `${adCount} ads`}</dd>
            <button type="button" className="adb-plan-edit" onClick={() => go(2)}>Edit</button>
          </div>
        </dl>
        <div className="adb-spend">
          <span className="adb-hint">Most it can spend</span>
          <strong>
            {money(totalDailyBudget(spec), currency)}
            <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-tertiary)" }}> a day</span>
          </strong>
        </div>
        {problems.length === 0 ? (
          <Badge tone="success" dot>
            Ready to launch
          </Badge>
        ) : (
          <ul className="adb-todo" aria-label="Still to do">
            {problems.slice(0, 5).map((p) => (
              <li key={p}>{tidyProblem(p)}</li>
            ))}
            {problems.length > 5 && <li>and {problems.length - 5} more</li>}
          </ul>
        )}
      </div>
    </aside>
  );

  const adSetTabs = (withAdd: boolean) =>
    spec.adSets.length > 1 || withAdd ? (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {spec.adSets.length > 1 && (
          <Segmented
            label="Ad set"
            value={String(si)}
            onChange={(v) => (setActiveSet(Number(v)), setActiveAd(0))}
            options={spec.adSets.map((x, j) => ({ key: String(j), label: x.name || `Ad set ${j + 1}` }))}
          />
        )}
        {withAdd && (
          <Button variant="ghost" size="sm" onClick={addAdSet}>
            <Plus size={14} /> Add ad set
          </Button>
        )}
      </div>
    ) : null;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <nav aria-label="Campaign steps" className="adb-steps">
        {STEPS.map((label, n) => (
          <span key={label} style={{ display: "contents" }}>
            {n > 0 && <span className="adb-step-line" aria-hidden />}
            <button type="button" className="adb-step" data-on={n === step} data-done={n < step} aria-current={n === step ? "step" : undefined} onClick={() => go(n)}>
              <span className="adb-step-num">{n < step ? <Check size={12} strokeWidth={3} /> : n + 1}</span>
              {label}
            </button>
          </span>
        ))}
      </nav>

      <div className="adb">
        <div className="adb-main">
          <div key={step} className="adb-step-anim" style={{ display: "grid", gap: 16 }}>
            {/* ── 1. Campaign ── */}
            {step === 0 && (
              <section className="adb-panel">
                <header className="adb-panel-head">
                  <h2>What should these ads do?</h2>
                  <p>Pick one goal. Meta shows the ads to the people most likely to do it.</p>
                </header>
                <ObjectiveCards options={objectiveOptions} value={spec.objective} onChange={setObjective} />
                {spec.objective === "messages" && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <span className="adb-hint">Open the chat in</span>
                    <Segmented
                      label="Open the chat in"
                      value={spec.messageDestination ?? "messenger"}
                      onChange={(v) => patch({ messageDestination: v })}
                      options={[
                        { key: "messenger", label: "Messenger" },
                        { key: "instagram", label: "Instagram" },
                      ]}
                    />
                  </div>
                )}

                {spec.objective === "leads" && spec.leadForm && (
                  <div className="adb-section">
                    <h3>Instant form <small>People fill it in without leaving Facebook or Instagram; each one lands in Leads.</small></h3>
                    <Segmented
                      label="Instant form"
                      value={spec.leadForm.existingFormId != null ? "existing" : "new"}
                      onChange={(v) =>
                        patch({
                          leadForm: { ...spec.leadForm!, existingFormId: v === "existing" ? (spec.leadForm!.existingFormId ?? pageForms?.[0]?.id ?? "") : null },
                        })
                      }
                      options={[
                        { key: "existing", label: "Use a form from your Page" },
                        { key: "new", label: "Create one here" },
                      ]}
                    />
                    {spec.leadForm.existingFormId != null ? (
                      pageForms === null ? (
                        <span className="adb-hint">Loading your Page&rsquo;s forms…</span>
                      ) : pageForms.length === 0 ? (
                        <span className="adb-hint">Your Page has no instant forms yet. Make one in Meta, or create one here.</span>
                      ) : (
                        <div style={{ maxWidth: 420, display: "grid", gap: 6 }}>
                          <select aria-label="Instant form" style={selectStyle} value={spec.leadForm.existingFormId} onChange={(e) => patch({ leadForm: { ...spec.leadForm!, existingFormId: e.target.value } })}>
                            {!pageForms.some((f) => f.id === spec.leadForm!.existingFormId) && <option value="">Choose a form</option>}
                            {pageForms.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                          <span className="adb-hint">Its questions, privacy policy and thank-you screen are used exactly as set up in Meta.</span>
                        </div>
                      )
                    ) : (
                      <div style={{ display: "grid", gap: 12 }}>
                        <div className="adb-grid">
                          <div>
                            <Label htmlFor="lf-head">Intro line</Label>
                            <Input id="lf-head" value={spec.leadForm.headline} placeholder="Leave your details and we will call you" onChange={(e) => patch({ leadForm: { ...spec.leadForm!, headline: e.target.value } })} />
                          </div>
                          <div>
                            <Label htmlFor="lf-name">Form name (only you see it)</Label>
                            <Input id="lf-name" value={spec.leadForm.name} onChange={(e) => patch({ leadForm: { ...spec.leadForm!, name: e.target.value } })} />
                          </div>
                          <div>
                            <Label htmlFor="lf-priv">Privacy policy link</Label>
                            <Input id="lf-priv" value={spec.leadForm.privacyPolicyUrl} placeholder="https://yoursite.ie/privacy" onChange={(e) => patch({ leadForm: { ...spec.leadForm!, privacyPolicyUrl: e.target.value } })} />
                          </div>
                          <div>
                            <Label htmlFor="lf-ty">Link after they submit</Label>
                            <Input id="lf-ty" value={spec.leadForm.thankYouUrl} placeholder="https://yoursite.ie" onChange={(e) => patch({ leadForm: { ...spec.leadForm!, thankYouUrl: e.target.value } })} />
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", fontSize: 13.5, color: "var(--text-secondary)" }}>
                          <span className="adb-hint">Ask for</span>
                          {(["FULL_NAME", "EMAIL", "PHONE"] as const).map((f) => (
                            <label key={f} style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
                    )}
                  </div>
                )}

                <div className="adb-section">
                  <h3>Details</h3>
                  <div className="adb-grid">
                    <div>
                      <Label htmlFor="ad-name">Campaign name (only you see it)</Label>
                      <Input id="ad-name" value={spec.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Autumn intro offer" />
                    </div>
                    <div>
                      <Label htmlFor="ad-account">Ad account (Meta bills it)</Label>
                      <select id="ad-account" style={selectStyle} value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)}>
                        {adAccounts.map((a) => (
                          <option key={a.adAccountId} value={a.adAccountId}>
                            {a.name ?? a.adAccountId} {a.currency ? `(${a.currency})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="ad-advertiser">Advertiser shown in the EU</Label>
                      <Input id="ad-advertiser" value={spec.advertiser ?? ""} onChange={(e) => patch({ advertiser: e.target.value })} placeholder={brand?.pageName ?? "Your Page name"} />
                    </div>
                  </div>
                  <span className="adb-hint">EU rules show people who the ad is for and who paid. Leave it blank to use your Page name.</span>
                </div>
              </section>
            )}

            {/* ── 2. Ad sets ── */}
            {step === 1 && (
              <section className="adb-panel">
                <header className="adb-panel-head">
                  <h2>Who sees it, and for how much</h2>
                  <p>This is an ad set: an audience with its own budget and dates. Most campaigns need one; add another to reach a different area or group.</p>
                </header>
                {adSetTabs(true)}
                <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 260px", maxWidth: 420 }}>
                    <Label htmlFor={`as-name-${si}`}>Ad set name (only you see it)</Label>
                    <Input id={`as-name-${si}`} value={set.name} onChange={(e) => patchSet(si, { name: e.target.value })} />
                  </div>
                  {spec.adSets.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => (patch({ adSets: spec.adSets.filter((_, j) => j !== si) }), setActiveSet(0))}>
                      <Trash2 size={14} /> Remove this ad set
                    </Button>
                  )}
                </div>

                <div className="adb-section">
                  <h3>Audience</h3>
                  <AudienceEditor key={si} index={si} audience={set.audience} onChange={(p) => patchAudience(si, p)} />
                </div>

                <div className="adb-section">
                  <h3>Daily budget <small>Meta never spends more than this in a day.</small></h3>
                  <BudgetStepper id={`as-budget-${si}`} value={set.dailyBudget} currency={currency} onChange={(n) => patchSet(si, { dailyBudget: n })} />
                </div>

                <div className="adb-section">
                  <h3>Schedule</h3>
                  <div className="adb-grid">
                    <div style={{ display: "grid", gap: 6 }}>
                      <span className="adb-hint">Starts</span>
                      <DateChoice id={`as-start-${si}`} value={set.startAt} onChange={(v) => patchSet(si, { startAt: v })} openLabel="At launch" dateLabel="On a date" />
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <span className="adb-hint">Ends</span>
                      <DateChoice id={`as-end-${si}`} value={set.endAt} onChange={(v) => patchSet(si, { endAt: v })} openLabel="When I pause it" dateLabel="On a date" />
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* ── 3. Ads ── */}
            {step === 2 && (
              <section className="adb-panel">
                <header className="adb-panel-head">
                  <h2>The ads</h2>
                  <p>A picture and the words around it. Add a second ad to let Meta test which one works better.</p>
                </header>
                {adSetTabs(false)}
                {set.ads.length > 1 && (
                  <Segmented
                    label="Ad"
                    value={String(Math.min(activeAd, set.ads.length - 1))}
                    onChange={(v) => setActiveAd(Number(v))}
                    options={set.ads.map((a, m) => ({ key: String(m), label: a.name || `Ad ${m + 1}` }))}
                  />
                )}
                {(() => {
                  const k = Math.min(activeAd, set.ads.length - 1);
                  const a = set.ads[k];
                  const source = a.creative.source ?? "design";
                  const chosen = a.creative.imageAssetIds ?? [];
                  const design = designs.find((d) => d.id === a.creative.designId);
                  return (
                    <>
                      <div className="adb-section" style={{ borderTop: "none", paddingTop: 0 }}>
                        <h3>Picture</h3>
                        <Segmented
                          label="Picture source"
                          value={source}
                          onChange={(v) => patchAd(si, k, { source: v })}
                          options={[
                            { key: "design", label: "Content Studio design" },
                            { key: "library", label: "Your photos" },
                            ...(videoAds.length ? [{ key: "video" as const, label: "Video ad" }] : []),
                          ]}
                        />
                        {source === "video" ? (
                          <>
                            <div className="adb-designs" role="radiogroup" aria-label="Video ad">
                              {videoAds.map((v) => (
                                <button key={v.id} type="button" role="radio" aria-checked={v.id === a.creative.adCreativeId} className="adb-design" data-on={v.id === a.creative.adCreativeId} onClick={() => patchAd(si, k, { adCreativeId: v.id })}>
                                  <span className="adb-design-img">
                                    <video src={`${v.videoUrl}#t=0.5`} preload="metadata" muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                  </span>
                                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
                                </button>
                              ))}
                            </div>
                            <span className="adb-hint">The square video runs in feeds and the 9:16 one in Stories and Reels.</span>
                          </>
                        ) : source === "design" ? (
                          designs.length === 0 ? (
                            <span className="adb-hint">No finished designs yet. Make one in Content Studio, or use your photos.</span>
                          ) : (
                            <>
                              <div className="adb-designs" role="radiogroup" aria-label="Design">
                                {designs.map((d) => (
                                  <button key={d.id} type="button" role="radio" aria-checked={d.id === a.creative.designId} className="adb-design" data-on={d.id === a.creative.designId} onClick={() => patchAd(si, k, { designId: d.id })}>
                                    <span className="adb-design-img">
                                      {/* eslint-disable-next-line @next/next/no-img-element -- our own render route */}
                                      {d.images[0] && <img src={d.images[0]} alt="" loading="lazy" />}
                                    </span>
                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                                  </button>
                                ))}
                              </div>
                              {design && design.slideCount > 1 && (
                                <Segmented
                                  label="Format"
                                  value={a.creative.format}
                                  onChange={(v) => patchAd(si, k, { format: v })}
                                  options={[
                                    { key: "single", label: "First slide only" },
                                    { key: "carousel", label: `Carousel (${design.slideCount} slides)` },
                                    { key: "options", label: "Let Meta choose a slide" },
                                  ]}
                                />
                              )}
                            </>
                          )
                        ) : (
                          <>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                              <label className="adb-seg-btn" style={{ border: "1px solid var(--hairline)", display: "inline-flex", alignItems: "center", gap: 6, cursor: uploading ? "wait" : "pointer", opacity: uploading ? 0.6 : 1 }}>
                                <Upload size={14} /> {uploading ? "Uploading…" : "Upload photos"}
                                <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading} style={{ display: "none" }} onChange={(e) => (void uploadPhotos(si, k, e.target.files), (e.target.value = ""))} />
                              </label>
                              <span className="adb-hint">Pick one photo, or several (up to 10) for a carousel or for Meta to choose from.</span>
                            </div>
                            {photos.length === 0 ? (
                              <span className="adb-hint">No photos in your library yet.</span>
                            ) : (
                              <div className="adb-photos">
                                {photos.map((ph) => {
                                  const pos = chosen.indexOf(ph.id);
                                  return (
                                    <button key={ph.id} type="button" title={ph.name} aria-pressed={pos >= 0} className="adb-photo" data-on={pos >= 0} onClick={() => patchAd(si, k, { imageAssetIds: pos >= 0 ? chosen.filter((x) => x !== ph.id) : [...chosen, ph.id].slice(0, 10) })}>
                                      {/* eslint-disable-next-line @next/next/no-img-element -- library thumbnails from our own route */}
                                      <img src={`/api/content-studio/image-library/file/${encodeURIComponent(ph.filename)}`} alt={ph.name} loading="lazy" />
                                      {pos >= 0 && <span className="adb-photo-n">{pos + 1}</span>}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            {chosen.length > 1 && (
                              <Segmented
                                label="How to show the photos"
                                value={a.creative.format === "options" ? "options" : "carousel"}
                                onChange={(v) => patchAd(si, k, { format: v })}
                                options={[
                                  { key: "carousel", label: "Carousel, in this order" },
                                  { key: "options", label: "Let Meta choose a photo" },
                                ]}
                              />
                            )}
                          </>
                        )}
                        {a.creative.format === "options" && (
                          <span className="adb-hint">Meta shows each person the picture it expects to work best, and learns which wins.</span>
                        )}
                      </div>

                      <div className="adb-section">
                        <h3>Words</h3>
                        <TextOptions
                          id={`ad-t-${si}-${k}`}
                          label="Main text (above the picture)"
                          multiline
                          first={a.creative.primaryText}
                          extras={a.creative.extraTexts ?? []}
                          onFirst={(v) => patchAd(si, k, { primaryText: v })}
                          onExtras={(v) => patchAd(si, k, { extraTexts: v })}
                        />
                        <TextOptions
                          id={`ad-h-${si}-${k}`}
                          label="Headline (below the picture)"
                          first={a.creative.headline}
                          extras={a.creative.extraHeadlines ?? []}
                          onFirst={(v) => patchAd(si, k, { headline: v })}
                          onExtras={(v) => patchAd(si, k, { extraHeadlines: v })}
                        />
                        <div style={{ maxWidth: 520 }}>
                          <Label htmlFor={`ad-ds-${si}-${k}`}>Description (optional)</Label>
                          <Input id={`ad-ds-${si}-${k}`} value={a.creative.description ?? ""} onChange={(e) => patchAd(si, k, { description: e.target.value })} />
                        </div>
                        {((a.creative.extraTexts?.length ?? 0) > 0 || (a.creative.extraHeadlines?.length ?? 0) > 0) && (
                          <span className="adb-hint">Meta mixes these and shows each person the combination it expects to work best. Step through them in the preview.</span>
                        )}
                      </div>

                      <div className="adb-section">
                        <h3>Button</h3>
                        <div className="adb-grid">
                          <div>
                            <Label htmlFor={`ad-c-${si}-${k}`}>Button text</Label>
                            <select id={`ad-c-${si}-${k}`} style={selectStyle} value={a.creative.cta} onChange={(e) => patchAd(si, k, { cta: e.target.value as Cta })} disabled={spec.objective === "messages"}>
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
                              <Input id={`ad-l-${si}-${k}`} value={a.creative.linkUrl ?? ""} placeholder="https://" onChange={(e) => patchAd(si, k, { linkUrl: e.target.value })} />
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingTop: 4, borderTop: "1px solid var(--hairline)" }}>
                        <Button variant="outline" size="sm" onClick={() => (patchSet(si, { ads: [...set.ads, newAd(designs, set.ads.length + 1)] }), setActiveAd(set.ads.length))}>
                          <Plus size={14} /> Add another ad
                        </Button>
                        {set.ads.length > 1 && (
                          <Button variant="ghost" size="sm" onClick={() => (patchSet(si, { ads: set.ads.filter((_, m) => m !== k) }), setActiveAd(0))}>
                            <X size={14} /> Remove this ad
                          </Button>
                        )}
                        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                          <Label htmlFor={`ad-n-${si}-${k}`}>Ad name</Label>
                          <Input id={`ad-n-${si}-${k}`} value={a.name} onChange={(e) => patchAd(si, k, { name: e.target.value })} style={{ width: 160 }} />
                        </span>
                      </div>
                    </>
                  );
                })()}
              </section>
            )}

            {/* ── 4. Review ── */}
            {step === 3 && (
              <section className="adb-panel">
                <header className="adb-panel-head">
                  <h2>Check it, then launch</h2>
                  <p>Nothing reaches Meta until you press Launch. It goes live after Meta&rsquo;s own review, usually within a few hours.</p>
                </header>
                {problems.length > 0 && (
                  <div style={{ display: "grid", gap: 8, padding: 14, borderRadius: "var(--radius)", background: "var(--warning-soft)" }}>
                    <strong style={{ fontSize: 13.5, color: "var(--text-primary)" }}>Before you can launch</strong>
                    <ul className="adb-todo">
                      {problems.map((p) => (
                        <li key={p}>{tidyProblem(p)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {spec.adSets.map((x, j) => (
                  <div key={j} className="adb-section" style={j === 0 && problems.length === 0 ? { borderTop: "none", paddingTop: 0 } : undefined}>
                    <h3>
                      {spec.adSets.length > 1 ? x.name || `Ad set ${j + 1}` : splitLabel(OBJECTIVE_LABEL[spec.objective])[0]}
                      <small>{whereOf(x)}</small>
                    </h3>
                    <div className="adb-hint">
                      {money(x.dailyBudget, currency)} a day · {runsOf(x)}
                    </div>
                    <div className="adb-designs">
                      {x.ads.map((a, m) => {
                        const img = imagesFor(a.creative)[0];
                        return (
                          <button key={m} type="button" className="adb-design" onClick={() => (setActiveSet(j), setActiveAd(m), go(2))} title="Edit this ad">
                            <span className="adb-design-img">
                              {/* eslint-disable-next-line @next/next/no-img-element -- our own image routes */}
                              {img && <img src={img} alt="" loading="lazy" />}
                            </span>
                            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{a.creative.headline || a.name}</span>
                            <span>{CTA_LABEL[a.creative.cta]}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            )}
          </div>

          <div className="adb-footer">
            {step > 0 && (
              <Button variant="ghost" onClick={() => go(step - 1)} disabled={busy}>
                <ArrowLeft size={15} /> Back
              </Button>
            )}
            <Button variant="ghost" onClick={onDelete} disabled={busy}>
              <Trash2 size={15} /> {id ? "Delete draft" : "Cancel"}
            </Button>
            <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <span aria-live="polite" className="adb-saved" style={saveState === "error" ? { color: "var(--danger)" } : undefined}>
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
                  <Rocket size={15} /> Launch for {money(totalDailyBudget(spec), currency)} a day
                </Button>
              )}
            </span>
          </div>
        </div>

        {rail}
      </div>
    </div>
  );
}

const STEPS = ["Campaign", "Ad sets", "Ads", "Review"] as const;

/** One text field plus up to 4 more versions of it, as in Ads Manager. */
function TextOptions({
  id,
  label,
  first,
  extras,
  onFirst,
  onExtras,
  multiline = false,
}: {
  id: string;
  label: string;
  first: string;
  extras: string[];
  onFirst: (v: string) => void;
  onExtras: (v: string[]) => void;
  multiline?: boolean;
}) {
  const field = (value: string, onChange: (v: string) => void, fid: string, aria?: string) =>
    multiline ? (
      <Textarea id={fid} aria-label={aria} rows={3} value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1 }} />
    ) : (
      <Input id={fid} aria-label={aria} value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1 }} />
    );
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Label htmlFor={id}>{label}</Label>
      {field(first, onFirst, id)}
      {extras.map((t, n) => (
        <div key={n} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          {field(t, (v) => onExtras(extras.map((x, m) => (m === n ? v : x))), `${id}-${n + 2}`, `${label}, version ${n + 2}`)}
          <Button variant="ghost" size="sm" aria-label={`Remove version ${n + 2}`} onClick={() => onExtras(extras.filter((_, m) => m !== n))}>
            <X size={14} />
          </Button>
        </div>
      ))}
      {extras.length < 4 && (
        <button type="button" className="adb-plan-edit" style={{ justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 4 }} onClick={() => onExtras([...extras, ""])}>
          <Plus size={13} /> Add another version ({extras.length + 1}/5)
        </button>
      )}
    </div>
  );
}

/** With one ad set, "Ad set 1 ("Ad set 1"), ad 1 needs..." says nothing the screen doesn't. */
function tidyProblem(p: string): string {
  const t = p.replace(/^Ad set 1 \("Ad set 1"\), /, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "Leads (an instant form; ...)" -> ["Leads", "An instant form; ..."] */
function splitLabel(label: string): [string, string] {
  const m = label.match(/^([^(]+)\((.*)\)$/);
  if (!m) return [label, ""];
  const desc = m[2].trim();
  return [m[1].trim(), desc.charAt(0).toUpperCase() + desc.slice(1)];
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
      <div className="adb-hint" style={{ fontWeight: 600, color: "var(--text-secondary)" }}>Where</div>
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

      <div className="adb-grid" style={{ marginTop: 10, alignItems: "end" }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="adb-hint" style={{ fontWeight: 600, color: "var(--text-secondary)" }}>Age</div>
          <AgeRange id={`age-${index}`} min={audience.ageMin} max={audience.ageMax} onChange={(ageMin, ageMax) => onChange({ ageMin, ageMax })} />
          {audience.advantageAudience && (audience.ageMin > 25 || audience.ageMax < 65) && (
            <span className="adb-hint">With Advantage+ audience on, Meta treats these ages as a suggestion and may reach a little outside them. Turn it off below for a strict range.</span>
          )}
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="adb-hint" style={{ fontWeight: 600, color: "var(--text-secondary)" }}>Gender</div>
          <Segmented
            label="Gender"
            value={audience.genders.length === 1 ? audience.genders[0] : "all"}
            onChange={(v) => onChange({ genders: v === "all" ? [] : [v] })}
            options={[
              { key: "all", label: "Everyone" },
              { key: "female", label: "Women" },
              { key: "male", label: "Men" },
            ]}
          />
        </div>
      </div>

      <div className="adb-hint" style={{ fontWeight: 600, color: "var(--text-secondary)", marginTop: 10 }}>
        Interests <span style={{ fontWeight: 400, color: "var(--text-tertiary)" }}>(optional)</span>
      </div>
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
