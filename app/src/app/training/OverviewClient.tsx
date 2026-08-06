"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Circle,
  ClipboardList,
  MessageSquare,
  Sparkles,
  Stethoscope,
  Trophy,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ProgressRing } from "@/components/training/ProgressRing";
import { useProgress } from "@/lib/training/progress";

interface LessonMeta {
  slug: string;
  number: string;
  title: string;
  summary: string;
  durationMin: number;
  quizCount: number;
}

interface Props {
  lessons: LessonMeta[];
  totalFlashcards: number;
  totalRoleplays: number;
}

export function OverviewClient({ lessons, totalFlashcards, totalRoleplays }: Props) {
  const { progress, hydrated, reset } = useProgress();
  const confirm = useConfirm();

  const stats = useMemo(() => {
    const moduleEntries = Object.values(progress.modules);
    const modulesRead = moduleEntries.filter((m) => m.read).length;
    const modulesQuizzed = moduleEntries.filter((m) => m.quizScore != null).length;
    const totalQuizScore = moduleEntries.reduce(
      (acc, m) => acc + (m.quizScore ?? 0),
      0,
    );
    const totalQuizMax = moduleEntries.reduce(
      (acc, m) => acc + (m.quizMax ?? 0),
      0,
    );
    const flashcardsLearned = Object.values(progress.flashcards).filter(Boolean).length;
    const roleplayEntries = Object.values(progress.roleplays);
    const roleplaysCompleted = roleplayEntries.filter(Boolean).length;
    const roleplaysAced = roleplayEntries.filter((r) => r === "success").length;

    const overall = (() => {
      const moduleWeight = lessons.length === 0 ? 0 : modulesRead / lessons.length;
      const quizWeight = totalQuizMax === 0 ? 0 : totalQuizScore / totalQuizMax;
      const flashWeight = totalFlashcards === 0 ? 0 : flashcardsLearned / totalFlashcards;
      const roleWeight = totalRoleplays === 0 ? 0 : roleplaysAced / totalRoleplays;
      return (moduleWeight * 0.3 + quizWeight * 0.3 + flashWeight * 0.2 + roleWeight * 0.2) * 100;
    })();

    return {
      modulesRead,
      modulesQuizzed,
      totalQuizScore,
      totalQuizMax,
      flashcardsLearned,
      roleplaysCompleted,
      roleplaysAced,
      overall,
    };
  }, [progress, lessons.length, totalFlashcards, totalRoleplays]);

  return (
    <div className="pane-stagger" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Top stats row */}
      <Card style={{ padding: 32 }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 32, alignItems: "center" }}>
          <ProgressRing value={hydrated ? stats.overall : 0} max={100} size={96} />
          <div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 500, marginBottom: 6 }}>
              Overall progress
            </div>
            <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 28, textTransform: "uppercase", color: "var(--text-primary)" }}>
              {stats.modulesRead}/{lessons.length} modules · {stats.flashcardsLearned}/{totalFlashcards} cards · {stats.roleplaysAced}/{totalRoleplays} scenarios aced
            </div>
            <div style={{ marginTop: 8, color: "var(--text-secondary)", fontSize: 13 }}>
              Quiz: {stats.totalQuizScore}/{stats.totalQuizMax} {stats.totalQuizMax > 0 && `(${Math.round((stats.totalQuizScore / stats.totalQuizMax) * 100)}%)`}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={async () => { if (await confirm({ title: "Reset all training progress?", destructive: true, confirmLabel: "Reset" })) reset(); }}>
            Reset progress
          </Button>
        </div>
      </Card>

      {/* Quick-jump tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <QuickJump
          href="/training/module/philosophy"
          icon={BookOpen}
          label="Start the modules"
          sub="9 lessons · ~75 min total"
        />
        <QuickJump
          href="/training/lookup"
          icon={Stethoscope}
          label="Condition lookup"
          sub="45+ conditions · interactive table"
        />
        <QuickJump
          href="/training/roleplay"
          icon={MessageSquare}
          label="Roleplay simulator"
          sub={`${totalRoleplays} branching scenarios`}
        />
        <QuickJump
          href="/training/drill"
          icon={Sparkles}
          label="Script drills"
          sub={`${totalFlashcards} flashcards`}
        />
      </div>

      {/* Modules list */}
      <div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
          <h2
            style={{
              fontFamily: "var(--font-heading), sans-serif",
              fontSize: 22,
              textTransform: "uppercase",
              color: "var(--text-primary)",
              fontWeight: 400,
            }}
          >
            The 9 Modules
          </h2>
          <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
            Work through in order — each builds on the last
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
          {lessons.map((l) => {
            const mp = progress.modules[l.slug];
            const read = !!mp?.read;
            const quizDone = mp?.quizScore != null;
            const quizText = quizDone ? `Quiz ${mp.quizScore}/${mp.quizMax}` : `${l.quizCount} quiz Qs`;
            return (
              <Link key={l.slug} href={`/training/module/${l.slug}`} style={{ display: "block" }}>
                <Card
                  style={{
                    padding: 22,
                    cursor: "pointer",
                    transition: "border-color 0.18s var(--ease), transform 0.18s var(--ease)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 13, color: "var(--text-tertiary)", letterSpacing: "0.08em" }}>
                      {l.number}
                    </div>
                    {hydrated && read ? (
                      <CheckCircle2 size={18} color="var(--text-primary)" strokeWidth={1.75} />
                    ) : (
                      <Circle size={18} color="var(--text-tertiary)" strokeWidth={1.5} />
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-heading), sans-serif",
                      fontSize: 19,
                      textTransform: "uppercase",
                      color: "var(--text-primary)",
                      lineHeight: 1.1,
                      marginBottom: 10,
                    }}
                  >
                    {l.title}
                  </div>
                  <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: 14, minHeight: 38 }}>
                    {l.summary}
                  </p>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "var(--text-tertiary)" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <ClipboardList size={13} /> {quizText}
                    </span>
                    <span>~{l.durationMin} min</span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Mastery panel */}
      <Card style={{ padding: 28, background: "var(--surface-1)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
          <Trophy size={20} strokeWidth={1.75} />
          <h3 style={{ fontFamily: "var(--font-heading), sans-serif", textTransform: "uppercase", fontSize: 16, color: "var(--text-primary)", fontWeight: 400 }}>
            Master the programme
          </h3>
        </div>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 720 }}>
          You'll be ready for live calls when you can: read all 9 modules, pass every quiz with 80%+, mark 80%+ of flashcards as mastered,
          and ace at least 4 of the {totalRoleplays} roleplay scenarios. The Condition Lookup is your reference — keep it open during calls.
        </p>
      </Card>
    </div>
  );
}

function QuickJump({ href, icon: Icon, label, sub }: { href: string; icon: typeof BookOpen; label: string; sub: string }) {
  return (
    <Link href={href} style={{ display: "block" }}>
      <Card style={{ padding: 22, cursor: "pointer" }}>
        <Icon size={20} strokeWidth={1.75} style={{ marginBottom: 14 }} />
        <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)", marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>{sub}</div>
        <div style={{ marginTop: 14, color: "var(--text-secondary)", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          Open <ArrowRight size={13} />
        </div>
      </Card>
    </Link>
  );
}
