"use client";

import { useEffect, useMemo, useState } from "react";
import { Shuffle, ArrowLeft, ArrowRight, RotateCw, CheckCircle2, Circle, Filter } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { Flashcard } from "@/lib/training/content";
import { useProgress } from "@/lib/training/progress";

const CATEGORIES: { v: Flashcard["category"] | "all"; l: string }[] = [
  { v: "all", l: "All categories" },
  { v: "opening", l: "Openings" },
  { v: "discovery", l: "Discovery" },
  { v: "validate", l: "Validate / educate" },
  { v: "recommend", l: "Recommend" },
  { v: "close", l: "Close" },
  { v: "objection", l: "Objections" },
  { v: "condition", l: "Conditions" },
];

interface Props {
  cards: Flashcard[];
}

export function DrillClient({ cards }: Props) {
  const { progress, hydrated, toggleFlashcard } = useProgress();
  const [category, setCategory] = useState<Flashcard["category"] | "all">("all");
  const [hideMastered, setHideMastered] = useState(false);
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [order, setOrder] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // Build current deck
  const deck = useMemo(() => {
    let pool = cards;
    if (category !== "all") pool = pool.filter((c) => c.category === category);
    if (hydrated && hideMastered) pool = pool.filter((c) => !progress.flashcards[c.id]);
    return pool;
  }, [cards, category, hideMastered, progress, hydrated]);

  // Rebuild card order whenever the deck or shuffle changes
  useEffect(() => {
    let ids = deck.map((c) => c.id);
    if (shuffleSeed > 0) {
      ids = [...ids];
      let s = shuffleSeed;
      for (let i = ids.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) | 0;
        const j = Math.abs(s) % (i + 1);
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
    }
    setOrder(ids);
    setIdx(0);
    setFlipped(false);
  }, [deck, shuffleSeed]);

  const current = order[idx] ? cards.find((c) => c.id === order[idx]) ?? null : null;
  const mastered = current && hydrated ? !!progress.flashcards[current.id] : false;
  const masteredCount = useMemo(() => deck.filter((c) => hydrated && progress.flashcards[c.id]).length, [deck, progress, hydrated]);

  const goNext = () => { setFlipped(false); setIdx((i) => (order.length === 0 ? 0 : (i + 1) % order.length)); };
  const goPrev = () => { setFlipped(false); setIdx((i) => (order.length === 0 ? 0 : (i - 1 + order.length) % order.length)); };
  const onToggleMastered = () => { if (current) toggleFlashcard(current.id, !mastered); };

  return (
    <div className="pane-stagger" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Filters */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 6px 8px 14px",
            background: "var(--bg)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius)",
            fontSize: 13,
            color: "var(--text-secondary)",
            cursor: "pointer",
          }}
        >
          <Filter size={13} strokeWidth={1.75} />
          <span style={{ color: "var(--text-tertiary)" }}>Category:</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
            style={{ border: "none", background: "transparent", color: "var(--text-primary)", fontSize: 13, padding: "0 8px", outline: "none", cursor: "pointer" }}
          >
            {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select>
        </label>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer", padding: "8px 14px", border: "1px solid var(--hairline)", borderRadius: "var(--radius)", background: "var(--bg)" }}>
          <input type="checkbox" checked={hideMastered} onChange={(e) => setHideMastered(e.target.checked)} style={{ cursor: "pointer" }} />
          Hide mastered
        </label>

        <Button variant="outline" size="sm" onClick={() => setShuffleSeed(Date.now() & 0x7fffffff)}>
          <Shuffle size={13} /> Shuffle
        </Button>

        <div style={{ flex: 1 }} />

        <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
          {hydrated ? `${masteredCount}/${deck.length} mastered` : `${deck.length} cards`}
        </div>
      </div>

      {/* Card */}
      {current ? (
        <Card style={{ padding: 0, overflow: "hidden", minHeight: 360 }}>
          <button
            type="button"
            onClick={() => setFlipped((f) => !f)}
            aria-label="Flip card"
            style={{
              width: "100%",
              minHeight: 360,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              color: "inherit",
              padding: 0,
              textAlign: "left",
              display: "block",
            }}
          >
            <div style={{
              padding: "20px 28px",
              background: "var(--surface-1)",
              borderBottom: "1px solid var(--hairline)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 500 }}>
                {flipped ? "Answer" : "Prompt"} · {current.category}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                Card {idx + 1} / {order.length}
              </div>
            </div>
            <div style={{ padding: "44px 36px 32px", minHeight: 260, display: "flex", alignItems: "center" }}>
              {flipped ? (
                <p style={{ fontSize: 18, lineHeight: 1.6, color: "var(--text-primary)", fontStyle: "italic" }}>
                  "{current.answer}"
                </p>
              ) : (
                <div>
                  <p style={{ fontSize: 22, lineHeight: 1.45, color: "var(--text-primary)", marginBottom: 14, fontFamily: "var(--font-heading), sans-serif", textTransform: "uppercase" }}>
                    {current.prompt}
                  </p>
                  <p style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
                    Click anywhere on the card to reveal the answer.
                  </p>
                </div>
              )}
            </div>
          </button>
        </Card>
      ) : (
        <Card style={{ padding: 60, textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "var(--text-tertiary)" }}>
            {hideMastered ? "All cards in this category are mastered. Switch off 'Hide mastered' to drill again." : "No cards match this filter."}
          </p>
        </Card>
      )}

      {/* Controls */}
      {current && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Button variant="outline" onClick={goPrev}>
            <ArrowLeft size={14} /> Previous
          </Button>
          <Button variant="outline" onClick={() => setFlipped((f) => !f)}>
            <RotateCw size={14} /> {flipped ? "Show prompt" : "Show answer"}
          </Button>
          <Button variant={mastered ? "secondary" : "primary"} onClick={onToggleMastered}>
            {mastered ? <CheckCircle2 size={14} /> : <Circle size={14} />}
            {mastered ? "Mastered" : "Mark mastered"}
          </Button>
          <div style={{ flex: 1 }} />
          <Button variant="primary" onClick={goNext}>
            Next <ArrowRight size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}
