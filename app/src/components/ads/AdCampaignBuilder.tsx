"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Rocket, Save, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
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
  initialSpec: CampaignSpec;
  initialAdAccountId: string;
  adAccounts: BuilderAdAccount[];
  designs: BuilderDesign[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [spec, setSpec] = useState<CampaignSpec>(initialSpec);
  const [adAccountId, setAdAccountId] = useState(initialAdAccountId);
  const [id, setId] = useState<number | null>(campaignId);
  const [busy, start] = useTransition();
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

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── Campaign ── */}
      <Card style={{ padding: 20, display: "grid", gap: 12 }}>
        <CardLabel>Campaign</CardLabel>
        <div style={grid2}>
          <div>
            <Label htmlFor="ad-name">Campaign name</Label>
            <Input id="ad-name" value={spec.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Autumn intro offer" />
          </div>
          <div>
            <Label htmlFor="ad-account">Ad account</Label>
            <select id="ad-account" style={selectStyle} value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)}>
              {adAccounts.map((a) => (
                <option key={a.adAccountId} value={a.adAccountId}>
                  {a.name ?? a.adAccountId} {a.currency ? `(${a.currency})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <Label htmlFor="ad-objective">What should these ads do?</Label>
          <select id="ad-objective" style={selectStyle} value={spec.objective} onChange={(e) => setObjective(e.target.value as Objective)}>
            {OBJECTIVES.map((o) => (
              <option key={o} value={o}>
                {OBJECTIVE_LABEL[o]}
              </option>
            ))}
          </select>
        </div>
        {spec.objective === "messages" && (
          <div>
            <Label htmlFor="ad-dest">Open a chat in</Label>
            <select id="ad-dest" style={selectStyle} value={spec.messageDestination ?? "messenger"} onChange={(e) => patch({ messageDestination: e.target.value as "messenger" | "instagram" })}>
              <option value="messenger">Messenger</option>
              <option value="instagram">Instagram</option>
            </select>
          </div>
        )}
      </Card>

      {/* ── Instant form ── */}
      {spec.objective === "leads" && spec.leadForm && (
        <Card style={{ padding: 20, display: "grid", gap: 12 }}>
          <CardLabel>Instant form</CardLabel>
          <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>People fill this in without leaving Facebook or Instagram. Each submission lands in Leads straight away.</div>
          <div style={grid2}>
            <div>
              <Label htmlFor="lf-name">Form name (only you see it)</Label>
              <Input id="lf-name" value={spec.leadForm.name} onChange={(e) => patch({ leadForm: { ...spec.leadForm!, name: e.target.value } })} />
            </div>
            <div>
              <Label htmlFor="lf-head">Intro line</Label>
              <Input id="lf-head" value={spec.leadForm.headline} placeholder="e.g. Leave your details and we will call you" onChange={(e) => patch({ leadForm: { ...spec.leadForm!, headline: e.target.value } })} />
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
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
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
        </Card>
      )}

      {/* ── Ad sets ── */}
      {spec.adSets.map((set, i) => (
        <Card key={i} style={{ padding: 20, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CardLabel>Ad set {i + 1}</CardLabel>
            {spec.adSets.length > 1 && (
              <Button variant="ghost" size="sm" style={{ marginLeft: "auto" }} onClick={() => patch({ adSets: spec.adSets.filter((_, j) => j !== i) })}>
                <Trash2 size={14} /> Remove ad set
              </Button>
            )}
          </div>
          <div style={grid2}>
            <div>
              <Label htmlFor={`as-name-${i}`}>Ad set name</Label>
              <Input id={`as-name-${i}`} value={set.name} onChange={(e) => patchSet(i, { name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={`as-budget-${i}`}>Daily budget ({currency})</Label>
              <Input id={`as-budget-${i}`} type="number" min={1} step={1} value={String(set.dailyBudget)} onChange={(e) => patchSet(i, { dailyBudget: Number(e.target.value) })} />
            </div>
            <div>
              <Label htmlFor={`as-start-${i}`}>Start (blank = at launch)</Label>
              <Input id={`as-start-${i}`} type="datetime-local" value={toLocalInput(set.startAt)} onChange={(e) => patchSet(i, { startAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </div>
            <div>
              <Label htmlFor={`as-end-${i}`}>End (blank = until paused)</Label>
              <Input id={`as-end-${i}`} type="datetime-local" value={toLocalInput(set.endAt)} onChange={(e) => patchSet(i, { endAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </div>
          </div>

          <AudienceEditor index={i} audience={set.audience} onChange={(p) => patchAudience(i, p)} />

          {set.ads.map((ad, k) => (
            <div key={k} style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: 14, display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>Ad {k + 1}</strong>
                {set.ads.length > 1 && (
                  <Button variant="ghost" size="sm" style={{ marginLeft: "auto" }} onClick={() => patchSet(i, { ads: set.ads.filter((_, m) => m !== k) })}>
                    <X size={14} /> Remove
                  </Button>
                )}
              </div>
              <div style={grid2}>
                <div>
                  <Label htmlFor={`ad-n-${i}-${k}`}>Ad name</Label>
                  <Input id={`ad-n-${i}-${k}`} value={ad.name} onChange={(e) => patchAd(i, k, { name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor={`ad-d-${i}-${k}`}>Content Studio design</Label>
                  <select id={`ad-d-${i}-${k}`} style={selectStyle} value={ad.creative.designId} onChange={(e) => patchAd(i, k, { designId: Number(e.target.value) })}>
                    {designs.length === 0 && <option value={0}>No designs yet: make one in Content Studio</option>}
                    {designs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.slideCount} {d.slideCount === 1 ? "image" : "images"})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor={`ad-f-${i}-${k}`}>Format</Label>
                  <select id={`ad-f-${i}-${k}`} style={selectStyle} value={ad.creative.format} onChange={(e) => patchAd(i, k, { format: e.target.value as "single" | "carousel" })}>
                    <option value="single">Single image (first slide)</option>
                    <option value="carousel">Carousel (every slide)</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor={`ad-c-${i}-${k}`}>Button</Label>
                  <select id={`ad-c-${i}-${k}`} style={selectStyle} value={ad.creative.cta} onChange={(e) => patchAd(i, k, { cta: e.target.value as Cta })} disabled={spec.objective === "messages"}>
                    {CTAS.map((c) => (
                      <option key={c} value={c}>
                        {CTA_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <Label htmlFor={`ad-t-${i}-${k}`}>Main text</Label>
                <Textarea id={`ad-t-${i}-${k}`} rows={3} value={ad.creative.primaryText} onChange={(e) => patchAd(i, k, { primaryText: e.target.value })} />
              </div>
              <div style={grid2}>
                <div>
                  <Label htmlFor={`ad-h-${i}-${k}`}>Headline</Label>
                  <Input id={`ad-h-${i}-${k}`} value={ad.creative.headline} onChange={(e) => patchAd(i, k, { headline: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor={`ad-ds-${i}-${k}`}>Description (optional)</Label>
                  <Input id={`ad-ds-${i}-${k}`} value={ad.creative.description ?? ""} onChange={(e) => patchAd(i, k, { description: e.target.value })} />
                </div>
                {spec.objective !== "messages" && (
                  <div>
                    <Label htmlFor={`ad-l-${i}-${k}`}>Website link{spec.objective === "leads" ? " (optional)" : ""}</Label>
                    <Input id={`ad-l-${i}-${k}`} value={ad.creative.linkUrl ?? ""} placeholder="https://" onChange={(e) => patchAd(i, k, { linkUrl: e.target.value })} />
                  </div>
                )}
              </div>
            </div>
          ))}
          <div>
            <Button variant="outline" size="sm" onClick={() => patchSet(i, { ads: [...set.ads, newAd(designs, set.ads.length + 1)] })}>
              <Plus size={14} /> Add another ad
            </Button>
          </div>
        </Card>
      ))}

      <div>
        <Button variant="outline" onClick={() => patch({ adSets: [...spec.adSets, newAdSet(designs, spec.adSets.length + 1)] })}>
          <Plus size={15} /> Add another ad set
        </Button>
      </div>

      {/* ── Footer ── */}
      <Card style={{ padding: 20, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, color: "var(--text-primary)" }}>
            Up to <strong>{money(totalDailyBudget(spec), currency)}</strong> a day across {spec.adSets.length} ad {spec.adSets.length === 1 ? "set" : "sets"}
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button onClick={onLaunch} disabled={busy || problems.length > 0}>
            <Rocket size={15} /> Launch
          </Button>
          <Button variant="outline" onClick={onSave} disabled={busy}>
            <Save size={15} /> Save draft
          </Button>
          <Button variant="ghost" onClick={onDelete} disabled={busy} style={{ marginLeft: "auto" }}>
            <Trash2 size={15} /> {id ? "Delete draft" : "Cancel"}
          </Button>
        </div>
      </Card>
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
      <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>Who sees it</strong>
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
