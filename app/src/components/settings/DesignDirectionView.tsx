"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronRight, Eye, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { applyDesignDirectionAction, clearDesignDirectionAction } from "@/app/settings/design/actions";

/**
 * Pick a direction, put your colours into its slots, optionally adjust its
 * typeface, type scale and photo grade, look at three real slides, then
 * apply. Applying is a button with a confirm and NOT autosave: it reshapes
 * every post from now on.
 *
 * The preview is the whole point of the page. A direction is a set of
 * decisions about type and grounds that only mean anything rendered, and
 * rendered in the tenant's own colours -- a picker showing stock swatches has
 * them choosing something they will never see. Every edit here -- a colour, a
 * size, the face -- invalidates the preview, and Apply waits for a new one.
 *
 * WHAT IS EDITABLE AND WHAT IS NOT. Typeface, the five type levels and the
 * photo grade are the direction's *voice*, and an operator can reasonably
 * have an opinion about them ("bigger headings", "less saturated"). The grid
 * and the ground rotation budgets are its *structure* -- "how many consecutive
 * slides may carry sage?" is not a question anyone wants a form for -- and
 * they stay the direction's. Edits are stored as overrides beside the choice,
 * never written into the direction, so "Direction's own" is always one click.
 */

type TypeLevel = "display" | "headline" | "subhead" | "body" | "label";
const TYPE_LEVELS: TypeLevel[] = ["display", "headline", "subhead", "body", "label"];

interface TypeStep {
  size: number;
  leading: number;
  tracking: number;
  weight: number;
  upper?: boolean;
}

interface PhotoGrade {
  saturate: number;
  contrast: number;
  brightness: number;
}

interface DirectionSummary {
  id: string;
  name: string;
  blurb: string;
  font: string;
  slots: { key: string; label: string; defaultHex: string }[];
  type: Record<TypeLevel, TypeStep>;
  photo: PhotoGrade | null;
}

/** Mirrors DirectionOverrides in lib/design/direction.ts -- the wire shape sent to preview and apply. */
interface Overrides {
  font?: string;
  type?: Partial<Record<TypeLevel, Partial<TypeStep>>>;
  photo?: PhotoGrade | null;
}

type Status =
  | { kind: "none" }
  | { kind: "custom" }
  | { kind: "direction"; directionId: string; palette: Record<string, string>; overrides: Overrides };

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The direction's own value with any override on top -- what the field shows. */
function effectiveStep(d: DirectionSummary, o: Overrides, level: TypeLevel): TypeStep {
  return { ...d.type[level], ...(o.type?.[level] ?? {}) };
}

function effectivePhoto(d: DirectionSummary, o: Overrides): PhotoGrade | null {
  if (o.photo === null) return null;
  return o.photo ?? d.photo;
}

function hasOverrides(o: Overrides): boolean {
  return o.font !== undefined || (o.type !== undefined && Object.keys(o.type).length > 0) || o.photo !== undefined;
}

export function DesignDirectionView({
  directions,
  fonts,
  status,
}: {
  directions: DirectionSummary[];
  /** The families the renderer can actually load. */
  fonts: string[];
  status: Status;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();

  const current = status.kind === "direction" ? status.directionId : null;
  const [selectedId, setSelectedId] = useState<string | null>(current);
  const selected = directions.find((d) => d.id === selectedId) ?? null;

  // Palette and overrides are kept PER direction, seeded from the stored choice
  // for the current one, so switching back and forth never loses edits.
  const [palettes, setPalettes] = useState<Record<string, Record<string, string>>>(() => {
    const init: Record<string, Record<string, string>> = {};
    for (const d of directions) {
      const base: Record<string, string> = {};
      for (const s of d.slots) base[s.key] = s.defaultHex;
      if (status.kind === "direction" && status.directionId === d.id) Object.assign(base, status.palette);
      init[d.id] = base;
    }
    return init;
  });
  const [overridesBy, setOverridesBy] = useState<Record<string, Overrides>>(() => {
    const init: Record<string, Overrides> = {};
    for (const d of directions) {
      init[d.id] = status.kind === "direction" && status.directionId === d.id ? status.overrides : {};
    }
    return init;
  });
  const palette = selected ? palettes[selected.id] : {};
  const overrides: Overrides = selected ? overridesBy[selected.id] : {};
  const paletteValid = selected ? selected.slots.every((s) => HEX.test(palette[s.key] ?? "")) : false;

  const [preview, setPreview] = useState<string[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Bumped whenever anything that feeds the preview changes, so a preview
  // request that was in flight when the operator kept editing can never land
  // on top of the newer state and re-enable Apply with stale slides.
  const previewToken = useRef(0);

  function invalidate() {
    setPreview(null);
    previewToken.current++;
  }

  function select(id: string) {
    setSelectedId(id);
    invalidate();
  }

  function setSlot(key: string, hex: string) {
    if (!selected) return;
    setPalettes((p) => ({ ...p, [selected.id]: { ...p[selected.id], [key]: hex } }));
    invalidate();
  }

  function patchOverrides(next: (o: Overrides) => Overrides) {
    if (!selected) return;
    setOverridesBy((all) => ({ ...all, [selected.id]: next(all[selected.id] ?? {}) }));
    invalidate();
  }

  function setStepField(level: TypeLevel, field: keyof TypeStep, value: number | boolean) {
    patchOverrides((o) => ({
      ...o,
      type: { ...(o.type ?? {}), [level]: { ...(o.type?.[level] ?? {}), [field]: value } },
    }));
  }

  async function runPreview() {
    if (!selected || !paletteValid) return;
    const token = ++previewToken.current;
    setPreviewing(true);
    try {
      const res = await fetch("/api/content-studio/design-direction/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directionId: selected.id, palette, overrides }),
      });
      if (token !== previewToken.current) return;
      if (!res.ok) {
        toast.error(res.status >= 502 && res.status <= 504 ? "The app was restarting. Try again in a moment." : `Preview failed (${res.status}).`);
        return;
      }
      let d: { ok?: boolean; slides?: unknown; error?: string };
      try {
        d = await res.json();
      } catch {
        toast.error("The preview reply wasn't readable.");
        return;
      }
      if (token !== previewToken.current) return;
      if (!d.ok || !Array.isArray(d.slides)) {
        toast.error(d.error ?? "Preview failed.");
        return;
      }
      setPreview(d.slides as string[]);
    } catch {
      toast.error("Couldn't reach the app.");
    } finally {
      if (token === previewToken.current) setPreviewing(false);
    }
  }

  async function apply() {
    if (!selected || !paletteValid) return;
    const ok = await confirm({
      title: `Use ${selected.name} for every post?`,
      body: "Adonis will compose every new post in this direction, in these colours and type. Existing posts are untouched. You can change it again here at any time.",
      confirmLabel: "Apply",
    });
    if (!ok) return;
    start(async () => {
      const r = await applyDesignDirectionAction({ directionId: selected.id, palette, overrides });
      if (r.ok) {
        toast.success(`${selected.name} is now your design direction.`);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  async function clear() {
    const ok = await confirm({
      title: "Go back to templates?",
      body:
        status.kind === "custom"
          ? "This removes the hand-authored design system on this account. Adonis will use the fixed templates until a direction is applied. This cannot be undone from here."
          : "Adonis will stop composing layouts and use the fixed templates instead. Your colours here are kept until you leave the page.",
      confirmLabel: "Use templates",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await clearDesignDirectionAction();
      if (r.ok) {
        toast.success("Back to templates.");
        setSelectedId(null);
        setPreview(null);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  const numberInput = (
    id: string,
    value: number,
    onChange: (v: number) => void,
    opts: { min: number; max: number; step: number; width?: number },
  ) => (
    <Input
      id={id}
      type="number"
      value={value}
      min={opts.min}
      max={opts.max}
      step={opts.step}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      style={{ width: opts.width ?? 88, fontFamily: "var(--font-mono), ui-monospace, monospace" }}
    />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Current state, plainly */}
      <Card style={{ padding: 20 }}>
        <CardLabel>In use</CardLabel>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "6px 0 0", lineHeight: 1.55 }}>
          {status.kind === "none" && "No direction. Adonis uses the fixed templates."}
          {status.kind === "custom" &&
            "A hand-authored design system. Applying a direction below replaces it; nothing changes until you do."}
          {status.kind === "direction" &&
            `${directions.find((d) => d.id === status.directionId)?.name ?? status.directionId}, in your colours${
              hasOverrides(status.overrides) ? ", with your own type and photo settings" : ""
            }.`}
        </p>
      </Card>

      {/* The six */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {directions.map((d) => {
          const isSelected = d.id === selectedId;
          const isCurrent = d.id === current;
          const shownFont = overridesBy[d.id]?.font ?? d.font;
          return (
            <Card
              key={d.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              style={{
                padding: 16,
                cursor: "pointer",
                border: isSelected ? "1px solid var(--accent)" : "1px solid var(--hairline)",
                background: isSelected ? "var(--accent-soft)" : undefined,
              }}
              onClick={() => select(d.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  select(d.id);
                }
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{d.name}</span>
                {isCurrent && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--accent)" }}>
                    <Check size={12} />
                    in use
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "6px 0 10px", lineHeight: 1.5 }}>{d.blurb}</p>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {d.slots.map((s) => (
                  <span
                    key={s.key}
                    title={s.label}
                    style={{ width: 18, height: 18, borderRadius: 4, background: palettes[d.id]?.[s.key] ?? s.defaultHex, border: "1px solid var(--hairline)" }}
                  />
                ))}
                <span style={{ fontSize: 12, color: "var(--text-tertiary)", marginLeft: "auto" }}>{shownFont}</span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Palette + type + preview + apply, for the selected direction */}
      {selected && (
        <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <CardLabel>Your colours in {selected.name}</CardLabel>
            <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: "4px 0 0", lineHeight: 1.5 }}>
              Each slot has a job. Put your brand colour in the slot that does that job, and the structure -- which
              grounds, how often, what may carry text -- stays the direction&apos;s. Colours that can&apos;t be read on
              any ground are kept off text automatically.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {selected.slots.map((s) => {
              const value = palette[s.key] ?? s.defaultHex;
              const valid = HEX.test(value);
              return (
                <div key={s.key}>
                  <Label htmlFor={`slot-${s.key}`}>{s.label}</Label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="color"
                      aria-label={`${s.label} colour`}
                      value={valid ? value : s.defaultHex}
                      onChange={(e) => setSlot(s.key, e.target.value)}
                      style={{ width: 40, height: 36, padding: 0, border: "1px solid var(--hairline)", borderRadius: "var(--radius-sm)", background: "transparent", cursor: "pointer" }}
                    />
                    <Input
                      id={`slot-${s.key}`}
                      value={value}
                      onChange={(e) => setSlot(s.key, e.target.value)}
                      placeholder={s.defaultHex}
                      style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
                    />
                  </div>
                  {!valid && (
                    <p style={{ fontSize: 12, color: "var(--danger)", margin: "4px 0 0" }}>Six-digit hex, like #1a1a1a.</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Typeface, type scale, photo grade */}
          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 14 }}>
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "transparent",
                border: 0,
                padding: 0,
                cursor: "pointer",
                color: "var(--text-primary)",
                fontFamily: "inherit",
                fontSize: 13.5,
                fontWeight: 600,
              }}
            >
              {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Typeface, type scale and photo
              {hasOverrides(overrides) && (
                <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--accent)", marginLeft: 6 }}>edited</span>
              )}
            </button>

            {advancedOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 14 }}>
                <div style={{ maxWidth: 320 }}>
                  <Label htmlFor="font">Typeface</Label>
                  <select
                    id="font"
                    value={overrides.font ?? selected.font}
                    onChange={(e) =>
                      patchOverrides((o) => {
                        const next = { ...o };
                        if (e.target.value === selected.font) delete next.font;
                        else next.font = e.target.value;
                        return next;
                      })
                    }
                    style={{
                      width: "100%",
                      background: "var(--bg)",
                      border: "1px solid var(--hairline)",
                      borderRadius: "var(--radius)",
                      padding: "10px 14px",
                      color: "var(--text-primary)",
                      fontSize: 14,
                      fontFamily: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    {fonts.map((f) => (
                      <option key={f} value={f}>
                        {f}
                        {f === selected.font ? " (the direction's own)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label>Type scale</Label>
                  <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: "2px 0 8px", lineHeight: 1.5 }}>
                    Pixels on a 1080-wide slide; other sizes scale with it. Line height is a multiple of the size,
                    letter spacing is in em.
                  </p>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ textAlign: "left", color: "var(--text-tertiary)" }}>
                          <th style={{ padding: "4px 8px 4px 0", fontWeight: 500 }}>Level</th>
                          <th style={{ padding: "4px 8px", fontWeight: 500 }}>Size</th>
                          <th style={{ padding: "4px 8px", fontWeight: 500 }}>Weight</th>
                          <th style={{ padding: "4px 8px", fontWeight: 500 }}>Line height</th>
                          <th style={{ padding: "4px 8px", fontWeight: 500 }}>Letter spacing</th>
                          <th style={{ padding: "4px 8px", fontWeight: 500 }}>Caps</th>
                        </tr>
                      </thead>
                      <tbody>
                        {TYPE_LEVELS.map((level) => {
                          const step = effectiveStep(selected, overrides, level);
                          return (
                            <tr key={level}>
                              <td style={{ padding: "4px 8px 4px 0", textTransform: "capitalize" }}>{level}</td>
                              <td style={{ padding: 4 }}>
                                {numberInput(`ts-${level}-size`, step.size, (v) => setStepField(level, "size", v), { min: 8, max: 400, step: 1 })}
                              </td>
                              <td style={{ padding: 4 }}>
                                {numberInput(`ts-${level}-weight`, step.weight, (v) => setStepField(level, "weight", v), { min: 100, max: 900, step: 100 })}
                              </td>
                              <td style={{ padding: 4 }}>
                                {numberInput(`ts-${level}-leading`, step.leading, (v) => setStepField(level, "leading", v), { min: 0.5, max: 4, step: 0.02 })}
                              </td>
                              <td style={{ padding: 4 }}>
                                {numberInput(`ts-${level}-tracking`, step.tracking, (v) => setStepField(level, "tracking", v), { min: -0.5, max: 1, step: 0.005 })}
                              </td>
                              <td style={{ padding: 4, textAlign: "center" }}>
                                <input
                                  type="checkbox"
                                  aria-label={`${level} in capitals`}
                                  checked={step.upper === true}
                                  onChange={(e) => setStepField(level, "upper", e.target.checked)}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <Label>Photo grade</Label>
                  <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: "2px 0 8px", lineHeight: 1.5 }}>
                    Multipliers applied to every photograph before it is placed. 1 leaves that quality unchanged.
                  </p>
                  {(() => {
                    const grade = effectivePhoto(selected, overrides);
                    return (
                      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
                          <input
                            type="checkbox"
                            checked={grade !== null}
                            onChange={(e) =>
                              patchOverrides((o) => ({
                                ...o,
                                photo: e.target.checked ? (selected.photo ?? { saturate: 1, contrast: 1, brightness: 1 }) : null,
                              }))
                            }
                          />
                          Grade photographs
                        </label>
                        {grade && (
                          <>
                            {(["saturate", "contrast", "brightness"] as const).map((k) => (
                              <div key={k}>
                                <Label htmlFor={`photo-${k}`}>{k.charAt(0).toUpperCase() + k.slice(1)}</Label>
                                {numberInput(
                                  `photo-${k}`,
                                  grade[k],
                                  (v) => patchOverrides((o) => ({ ...o, photo: { ...(effectivePhoto(selected, o) ?? grade), [k]: v } })),
                                  { min: 0, max: 4, step: 0.02 },
                                )}
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!hasOverrides(overrides)}
                    onClick={() => patchOverrides(() => ({}))}
                  >
                    <RotateCcw size={13} />
                    Direction&apos;s own type and photo
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Button variant="outline" onClick={runPreview} disabled={previewing || !paletteValid}>
              {previewing ? <Loader2 size={14} className="spin" /> : <Eye size={14} />}
              {previewing ? "Rendering…" : "Preview three slides"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const base: Record<string, string> = {};
                for (const s of selected.slots) base[s.key] = s.defaultHex;
                setPalettes((p) => ({ ...p, [selected.id]: base }));
                invalidate();
              }}
            >
              <RotateCcw size={14} />
              Direction&apos;s own colours
            </Button>
            <span style={{ flex: 1 }} />
            <Button variant="primary" onClick={apply} disabled={pending || !paletteValid || !preview}>
              {pending ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              {current === selected.id ? "Apply changes" : `Use ${selected.name}`}
            </Button>
          </div>
          {!preview && (
            <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: 0 }}>
              Preview first. You apply what you have seen, not what you hope it looks like.
            </p>
          )}

          {preview && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {preview.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={src} alt={`${selected.name} sample slide ${i + 1}`} style={{ width: "100%", height: "auto", borderRadius: "var(--radius)", border: "1px solid var(--hairline)" }} />
              ))}
            </div>
          )}
        </Card>
      )}

      {status.kind !== "none" && (
        <Card style={{ padding: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Back to templates</div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 0" }}>
              Stop composing layouts and use the fixed templates only.
            </p>
          </div>
          <Button variant="outline" onClick={clear} disabled={pending}>
            Use templates only
          </Button>
        </Card>
      )}
    </div>
  );
}
