"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Play, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Reveal, RevealGroup } from "@/components/motion/Reveal";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { bulkFindExerciseVideosAction, deleteExerciseAction, findExerciseVideoAction, saveExerciseAction } from "@/app/workout/exercises/actions";
import type { ExerciseLibRow } from "@/lib/exerciseLibrary";
import { parseYouTubeId, youtubeEmbedUrl } from "@/lib/youtube";

export function ExerciseLibraryView({ exercises }: { exercises: ExerciseLibRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ExerciseLibRow | null>(null);
  const [bulking, startBulk] = useTransition();

  const missingCount = useMemo(
    () => exercises.filter((e) => !parseYouTubeId(e.videoUrl)).length,
    [exercises],
  );

  const bulkFind = () => {
    const t = toast.loading(`Searching YouTube for ${Math.min(missingCount, 40)} exercise${missingCount === 1 ? "" : "s"}…`);
    startBulk(async () => {
      const res = await bulkFindExerciseVideosAction();
      toast.dismiss(t);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.found === 0) toast.info("No new videos found this run.");
      else toast.success(`Added ${res.found} video${res.found === 1 ? "" : "s"}${res.remaining > 0 ? ` — ${res.remaining} still missing (run again to continue).` : "."}`);
      router.refresh();
    });
  };

  const [activeCat, setActiveCat] = useState<string>("All");

  // Categories with counts, most-populated first (for the filter chips).
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of exercises) {
      const c = (e.category || "Uncategorised").trim() || "Uncategorised";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [exercises]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return exercises.filter((e) => {
      const cat = (e.category || "Uncategorised").trim() || "Uncategorised";
      if (activeCat !== "All" && cat !== activeCat) return false;
      if (!query) return true;
      return (
        e.name.toLowerCase().includes(query) ||
        cat.toLowerCase().includes(query) ||
        e.muscleGroups.some((m) => m.toLowerCase().includes(query))
      );
    });
  }, [exercises, q, activeCat]);

  // Group the filtered exercises under their category (alphabetical headings).
  const groups = useMemo(() => {
    const m = new Map<string, ExerciseLibRow[]>();
    for (const e of filtered) {
      const c = (e.category || "Uncategorised").trim() || "Uncategorised";
      const arr = m.get(c);
      if (arr) arr.push(e);
      else m.set(c, [e]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
          {exercises.length} exercise{exercises.length === 1 ? "" : "s"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative", width: 240 }}>
            <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search exercises…" style={{ paddingLeft: 32 }} />
          </div>
          {missingCount > 0 && (
            <Button variant="ghost" onClick={bulkFind} disabled={bulking} title="Find a YouTube how-to video for every exercise that doesn't have one">
              <Sparkles size={15} /> {bulking ? "Finding…" : `Auto-find ${missingCount} video${missingCount === 1 ? "" : "s"}`}
            </Button>
          )}
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus size={15} /> Add exercise
          </Button>
        </div>
      </div>

      {/* Category filter chips */}
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <CatChip label="All" count={exercises.length} active={activeCat === "All"} onClick={() => setActiveCat("All")} />
        {categories.map(([cat, n]) => (
          <CatChip key={cat} label={cat} count={n} active={activeCat === cat} onClick={() => setActiveCat(cat)} />
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: "36px 16px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 13.5, border: "1px solid var(--hairline)", borderRadius: "var(--radius)" }}>
          {exercises.length === 0 ? (
            <>No exercises yet. Click <strong>Add exercise</strong> to build your library.</>
          ) : (
            <>No exercises match your search.</>
          )}
        </div>
      ) : (
        <RevealGroup style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {groups.map(([cat, items]) => (
            <Reveal key={cat}>
              <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{cat}</h3>
                <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace" }}>{items.length}</span>
              </div>
              <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <div style={{ minWidth: 680 }}>
                    <div style={{ ...row, ...headRow }}>
                      <div>Exercise</div>
                      <div>Equipment</div>
                      <div>Muscle groups</div>
                      <div style={{ textAlign: "right" }}>Actions</div>
                    </div>
                    {items.map((e) => (
                      <div key={e.id} style={row}>
                        <button onClick={() => { setEditing(e); setOpen(true); }} style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: 0, minWidth: 0 }}>
                          {parseYouTubeId(e.videoUrl) && (
                            <span title="Has video" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 5, background: "#ff000018", color: "#ff3b30", flexShrink: 0 }}>
                              <Play size={11} fill="currentColor" />
                            </span>
                          )}
                          <span style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{e.name}</span>
                        </button>
                        <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{e.equipment || "—"}</div>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {e.muscleGroups.length === 0 ? (
                            <span style={{ color: "var(--text-tertiary)", fontSize: 12.5 }}>—</span>
                          ) : (
                            e.muscleGroups.slice(0, 4).map((m) => (
                              <span key={m} style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 5, background: "var(--surface-2)", color: "var(--text-secondary)", fontFamily: "var(--font-mono), monospace" }}>
                                {m}
                              </span>
                            ))
                          )}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <button onClick={() => { setEditing(e); setOpen(true); }} aria-label="Edit" style={iconBtn}>
                            <Pencil size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              </div>
            </Reveal>
          ))}
        </RevealGroup>
      )}

      <ExerciseSheet
        open={open}
        editing={editing}
        onClose={() => setOpen(false)}
        onSaved={() => { setOpen(false); router.refresh(); }}
      />
    </div>
  );
}

function ExerciseSheet({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: ExerciseLibRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [finding, startFind] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [muscles, setMuscles] = useState("");
  const [equipment, setEquipment] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [instructions, setInstructions] = useState("");

  const [seed, setSeed] = useState<number | "new" | null>(null);
  const key = editing ? editing.id : "new";
  if (open && seed !== key) {
    setSeed(key);
    setName(editing?.name ?? "");
    setCategory(editing?.category ?? "");
    setMuscles((editing?.muscleGroups ?? []).join(", "));
    setEquipment(editing?.equipment ?? "");
    setVideoUrl(editing?.videoUrl ?? "");
    setImageUrl(editing?.imageUrl ?? "");
    setInstructions(editing?.instructions ?? "");
  }
  if (!open && seed !== null) setSeed(null);

  const submit = () => {
    if (!name.trim()) return toast.error("Give the exercise a name.");
    start(async () => {
      const res = await saveExerciseAction({
        id: editing?.id,
        name,
        category: category || null,
        muscleGroups: muscles.split(",").map((m) => m.trim()).filter(Boolean),
        equipment: equipment || null,
        videoUrl: videoUrl || null,
        imageUrl: imageUrl || null,
        instructions: instructions || null,
      });
      if (res.ok) {
        toast.success(editing ? "Exercise updated." : "Exercise added.");
        onSaved();
      } else toast.error(res.error);
    });
  };

  const autoFind = () => {
    if (!name.trim()) return toast.error("Enter the exercise name first.");
    startFind(async () => {
      const res = await findExerciseVideoAction(name.trim());
      if (res.ok) {
        setVideoUrl(res.url);
        toast.success(`Found: ${res.title}${res.channel ? ` — ${res.channel}` : ""}`);
      } else {
        toast.error(res.error);
      }
    });
  };

  const videoId = parseYouTubeId(videoUrl);

  const remove = () => {
    if (!editing) return;
    start(async () => {
      await deleteExerciseAction(editing.id);
      toast.success("Exercise deleted.");
      onSaved();
    });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={editing ? "Edit exercise" : "Add exercise"} width={460}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <Label htmlFor="ex-name">Name</Label>
            <Input id="ex-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dumbbell Bench Press" autoFocus />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <Label htmlFor="ex-cat">Category</Label>
              <Input id="ex-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Chest" />
            </div>
            <div>
              <Label htmlFor="ex-equip">Equipment</Label>
              <Input id="ex-equip" value={equipment} onChange={(e) => setEquipment(e.target.value)} placeholder="e.g. Dumbbell" />
            </div>
          </div>
          <div>
            <Label htmlFor="ex-muscles">Muscle groups</Label>
            <Input id="ex-muscles" value={muscles} onChange={(e) => setMuscles(e.target.value)} placeholder="Chest, Triceps, Front Delts (comma separated)" />
            <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 4 }}>Used to compute total volume sets in programs.</div>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Label htmlFor="ex-video">Video</Label>
              <button
                type="button"
                onClick={autoFind}
                disabled={finding || !name.trim()}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600,
                  padding: "4px 9px", borderRadius: 6, cursor: name.trim() ? "pointer" : "not-allowed",
                  border: "1px solid var(--hairline)", background: "var(--surface-2)", color: "var(--text-secondary)",
                  opacity: finding ? 0.6 : 1,
                }}
              >
                <Sparkles size={12} /> {finding ? "Searching…" : "Auto-find on YouTube"}
              </button>
            </div>
            {videoId && (
              <div style={{ marginTop: 8, marginBottom: 8, position: "relative", width: "100%", paddingTop: "56.25%", borderRadius: "var(--radius)", overflow: "hidden", border: "1px solid var(--hairline)", background: "#000" }}>
                <iframe
                  src={youtubeEmbedUrl(videoId)}
                  title="Exercise video preview"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                />
              </div>
            )}
            <Input id="ex-video" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="Paste a YouTube link, or use Auto-find" />
            <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 4 }}>
              {videoId ? "YouTube video will embed in the exercise." : "Paste any YouTube link and it embeds automatically."}
            </div>
          </div>
          <div>
            <Label htmlFor="ex-image">Image URL</Label>
            <Input id="ex-image" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <Label htmlFor="ex-instr">Instructions</Label>
            <Textarea id="ex-instr" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
            {editing ? (
              <Button variant="ghost" onClick={remove} disabled={pending} aria-label="Delete exercise">
                <Trash2 size={14} />
              </Button>
            ) : (
              <span />
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
              <Button onClick={submit} disabled={pending}>{pending ? "Saving…" : editing ? "Save" : "Add exercise"}</Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CatChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 999,
        fontSize: 12.5, fontWeight: active ? 600 : 500, cursor: "pointer",
        border: `1px solid ${active ? "var(--accent)" : "var(--hairline)"}`,
        background: active ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-secondary)",
      }}
    >
      {label}
      <span style={{ fontSize: 10.5, opacity: 0.75, fontFamily: "var(--font-mono), monospace" }}>{count}</span>
    </button>
  );
}

const row: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.6fr 1fr 1.6fr 0.6fr",
  gap: 12,
  padding: "11px 16px",
  borderBottom: "1px solid var(--hairline)",
  alignItems: "center",
  fontSize: 13,
};
const headRow: React.CSSProperties = {
  background: "var(--surface-1)",
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-tertiary)",
  fontFamily: "var(--font-mono), monospace",
};
const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
};
