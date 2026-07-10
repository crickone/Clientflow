"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Check, X, RotateCcw, Lightbulb, AlertTriangle, ListChecks } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { Lesson, Section, TherapyProfile } from "@/lib/training/content";
import { useProgress } from "@/lib/training/progress";

interface Props {
  lesson: Lesson;
  therapies: TherapyProfile[] | null;
  prev: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
}

export function ModuleClient({ lesson, therapies, prev, next }: Props) {
  const { progress, hydrated, markModuleRead, recordQuiz } = useProgress();
  const moduleState = progress.modules[lesson.slug];
  const moduleRead = hydrated && !!moduleState?.read;

  useEffect(() => {
    // mark the lesson as read once viewed for >5s
    const t = setTimeout(() => markModuleRead(lesson.slug), 5000);
    return () => clearTimeout(t);
  }, [lesson.slug, markModuleRead]);

  return (
    <div className="pane-stagger" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Sections */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {lesson.sections.map((s, i) => (
          <SectionBlock key={i} section={s} />
        ))}

        {/* Therapy profiles for the therapies module */}
        {therapies && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
            {therapies.map((t) => (
              <TherapyCard key={t.short} t={t} />
            ))}
          </div>
        )}
      </div>

      {/* Key takeaways */}
      <Card style={{ padding: 26, background: "var(--surface-1)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <ListChecks size={18} strokeWidth={1.75} />
          <h3 style={{ fontFamily: "var(--font-heading), sans-serif", textTransform: "uppercase", fontSize: 15, fontWeight: 400, color: "var(--text-primary)" }}>
            Key takeaways
          </h3>
        </div>
        <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          {lesson.keyTakeaways.map((t, i) => (
            <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, color: "var(--text-primary)" }}>
              <CheckCircle2 size={16} strokeWidth={1.75} style={{ marginTop: 2, color: "var(--text-secondary)" }} />
              {t}
            </li>
          ))}
        </ul>
      </Card>

      {/* Quiz */}
      <Quiz lesson={lesson} onComplete={(score, max) => recordQuiz(lesson.slug, score, max)} bestScore={moduleState?.quizScore ?? null} bestMax={moduleState?.quizMax ?? null} />

      {/* Footer nav */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, paddingTop: 8 }}>
        {prev ? (
          <Link href={`/training/module/${prev.slug}`}>
            <Button variant="outline">
              <ArrowLeft size={14} />
              {prev.title}
            </Button>
          </Link>
        ) : <span />}
        {next ? (
          <Link href={`/training/module/${next.slug}`}>
            <Button variant="primary">
              {next.title}
              <ArrowRight size={14} />
            </Button>
          </Link>
        ) : (
          <Link href="/training/roleplay">
            <Button variant="primary">
              Run a roleplay
              <ArrowRight size={14} />
            </Button>
          </Link>
        )}
      </div>

      {moduleRead && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-tertiary)", fontSize: 12, justifyContent: "flex-end" }}>
          <CheckCircle2 size={14} /> Module marked as read
        </div>
      )}
    </div>
  );
}

function SectionBlock({ section }: { section: Section }) {
  const isDont = section.tone === "dont";
  const isDo = section.tone === "do";

  return (
    <Card style={{ padding: 28 }}>
      <h2
        style={{
          fontFamily: "var(--font-heading), sans-serif",
          fontSize: 16,
          textTransform: "uppercase",
          color: "var(--text-primary)",
          fontWeight: 400,
          letterSpacing: "-0.005em",
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        {section.heading}
      </h2>

      {section.paragraphs && section.paragraphs.map((p, i) => (
        <p key={i} style={{ fontSize: 14.5, lineHeight: 1.65, color: "var(--text-secondary)", marginBottom: i === section.paragraphs!.length - 1 ? 0 : 12 }}>{p}</p>
      ))}

      {section.bullets && (
        <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          {section.bullets.map((b, i) => (
            <li key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: 14, lineHeight: 1.55, color: "var(--text-primary)" }}>
              {isDont ? (
                <X size={16} color="#dc2626" strokeWidth={2} style={{ marginTop: 2, flexShrink: 0 }} />
              ) : isDo ? (
                <Check size={16} color="#16a34a" strokeWidth={2} style={{ marginTop: 2, flexShrink: 0 }} />
              ) : (
                <span style={{ marginTop: 9, width: 5, height: 5, background: "var(--text-tertiary)", borderRadius: "50%", flexShrink: 0 }} />
              )}
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}

      {section.scripts && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {section.scripts.map((s, i) => (
            <div key={i} style={{ border: "1px solid var(--hairline)", borderLeft: "3px solid var(--text-primary)", borderRadius: "var(--radius-sm)", padding: "14px 18px", background: "var(--surface-1)" }}>
              <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 500, marginBottom: 8 }}>
                {s.label}
              </div>
              <div style={{ fontSize: 14.5, color: "var(--text-primary)", lineHeight: 1.6, fontStyle: "italic" }}>
                "{s.body}"
              </div>
            </div>
          ))}
        </div>
      )}

      {section.callout && (
        <div style={{ display: "flex", gap: 14, padding: 16, background: "rgba(44, 108, 224, 0.04)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-sm)" }}>
          <Lightbulb size={18} strokeWidth={1.75} style={{ marginTop: 2, color: "var(--accent-hbot)", flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6, fontWeight: 500 }}>
              {section.callout.label}
            </div>
            <div style={{ fontSize: 14.5, color: "var(--text-primary)", lineHeight: 1.6 }}>
              {section.callout.body}
            </div>
          </div>
        </div>
      )}

      {section.table && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {section.table.headers.map((h, i) => (
                  <th
                    key={i}
                    style={{
                      textAlign: "left",
                      padding: "12px 14px",
                      borderBottom: "1px solid var(--hairline)",
                      fontSize: 11,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--text-tertiary)",
                      fontWeight: 500,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      style={{
                        padding: "14px",
                        borderBottom: i === section.table!.rows.length - 1 ? "none" : "1px solid var(--hairline)",
                        fontSize: 13.5,
                        color: j === 0 ? "var(--text-primary)" : "var(--text-secondary)",
                        fontWeight: j === 0 ? 500 : 400,
                        lineHeight: 1.55,
                        verticalAlign: "top",
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TherapyCard({ t }: { t: TherapyProfile }) {
  const accentVar = `var(--accent-${t.accent})`;
  return (
    <Card style={{ padding: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 20, textTransform: "uppercase", color: "var(--text-primary)" }}>
          {t.short}
        </div>
        <span style={{
          width: 8,
          height: 8,
          borderRadius: "var(--radius)",
          background: accentVar,
          display: "inline-block",
        }} />
      </div>
      <div style={{ fontSize: 12, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
        {t.name}
      </div>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)", fontStyle: "italic", marginBottom: 16, paddingLeft: 12, borderLeft: `2px solid ${accentVar}` }}>
        "{t.oneLiner}"
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16, fontSize: 13 }}>
        <div><span style={{ color: "var(--text-tertiary)" }}>Duration: </span><span style={{ color: "var(--text-primary)" }}>{t.duration}</span></div>
        <div><span style={{ color: "var(--text-tertiary)" }}>Course: </span><span style={{ color: "var(--text-primary)" }}>{t.course}</span></div>
      </div>
      <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 500, marginBottom: 8 }}>
        Best for
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
        {t.bestFor.map((b) => (
          <span key={b} style={{ fontSize: 12, padding: "4px 10px", background: "var(--surface-2)", border: "1px solid var(--hairline)", borderRadius: "var(--radius)", color: "var(--text-primary)" }}>
            {b}
          </span>
        ))}
      </div>
      <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 500, marginBottom: 8 }}>
        What it feels like
      </div>
      <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: 16 }}>{t.feels}</p>
      <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 500, marginBottom: 8 }}>
        Key points
      </div>
      <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
        {t.keyPoints.map((p, i) => (
          <li key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "var(--text-primary)", lineHeight: 1.55 }}>
            <span style={{ marginTop: 7, width: 4, height: 4, background: accentVar, borderRadius: "50%", flexShrink: 0 }} />
            {p}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Quiz({ lesson, onComplete, bestScore, bestMax }: { lesson: Lesson; onComplete: (s: number, m: number) => void; bestScore: number | null; bestMax: number | null }) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    setSubmitted(true);
    let score = 0;
    lesson.quiz.forEach((q, i) => { if (answers[i] === q.answer) score++; });
    onComplete(score, lesson.quiz.length);
  };

  const handleReset = () => {
    setAnswers({});
    setSubmitted(false);
  };

  const score = Object.entries(answers).filter(([i, a]) => lesson.quiz[Number(i)].answer === a).length;
  const allAnswered = Object.keys(answers).length === lesson.quiz.length;
  const passed = submitted && score / lesson.quiz.length >= 0.8;

  return (
    <Card style={{ padding: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 22, textTransform: "uppercase", fontWeight: 400, color: "var(--text-primary)" }}>
          Knowledge check
        </h2>
        {bestScore != null && bestMax != null && (
          <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
            Best: {bestScore}/{bestMax}
          </div>
        )}
      </div>
      <p style={{ fontSize: 13.5, color: "var(--text-secondary)", marginBottom: 20 }}>
        Aim for 80%+ to pass.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {lesson.quiz.map((q, i) => {
          const picked = answers[i];
          const correct = q.answer;
          return (
            <div key={i}>
              <div style={{ fontSize: 14.5, color: "var(--text-primary)", marginBottom: 12, fontWeight: 500 }}>
                {i + 1}. {q.q}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {q.choices.map((c, j) => {
                  let bg = "var(--bg)";
                  let border = "var(--hairline)";
                  let icon: React.ReactNode = null;
                  if (submitted) {
                    if (j === correct) { bg = "rgba(22, 163, 74, 0.06)"; border = "rgba(22, 163, 74, 0.4)"; icon = <Check size={15} color="#16a34a" strokeWidth={2} />; }
                    else if (j === picked && picked !== correct) { bg = "rgba(220, 38, 38, 0.05)"; border = "rgba(220, 38, 38, 0.35)"; icon = <X size={15} color="#dc2626" strokeWidth={2} />; }
                  } else if (j === picked) {
                    border = "var(--hairline-strong)";
                    bg = "var(--surface-1)";
                  }
                  return (
                    <button
                      key={j}
                      type="button"
                      disabled={submitted}
                      onClick={() => setAnswers((a) => ({ ...a, [i]: j }))}
                      style={{
                        textAlign: "left",
                        padding: "12px 16px",
                        background: bg,
                        border: `1px solid ${border}`,
                        borderRadius: "var(--radius-sm)",
                        fontSize: 14,
                        color: "var(--text-primary)",
                        cursor: submitted ? "default" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        transition: "background 0.15s var(--ease), border-color 0.15s var(--ease)",
                      }}
                    >
                      <span style={{
                        width: 22, height: 22, flexShrink: 0,
                        borderRadius: "50%",
                        border: `1px solid ${picked === j ? "var(--text-primary)" : "var(--hairline-strong)"}`,
                        background: picked === j && !submitted ? "var(--text-primary)" : "transparent",
                        color: picked === j && !submitted ? "var(--bg)" : "var(--text-secondary)",
                        fontSize: 11,
                        fontWeight: 600,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}>
                        {String.fromCharCode(65 + j)}
                      </span>
                      <span style={{ flex: 1 }}>{c}</span>
                      {icon}
                    </button>
                  );
                })}
              </div>
              {submitted && (
                <div style={{ marginTop: 10, padding: "10px 14px", fontSize: 13, color: "var(--text-secondary)", background: "var(--surface-1)", borderRadius: "var(--radius-sm)", borderLeft: "2px solid var(--text-primary)" }}>
                  <strong style={{ color: "var(--text-primary)" }}>Why:</strong> {q.explain}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 24, display: "flex", gap: 12, alignItems: "center" }}>
        {!submitted ? (
          <Button onClick={handleSubmit} disabled={!allAnswered}>
            Submit · check answers
          </Button>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {passed ? (
                <CheckCircle2 size={20} color="#16a34a" strokeWidth={2} />
              ) : (
                <AlertTriangle size={20} color="#dc2626" strokeWidth={2} />
              )}
              <div>
                <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 18, textTransform: "uppercase", color: "var(--text-primary)" }}>
                  {score}/{lesson.quiz.length} {passed ? "Passed" : "Try again"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                  {passed ? "Best score saved." : "80% required to pass — review and retry."}
                </div>
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <Button variant="outline" onClick={handleReset}>
              <RotateCcw size={14} /> Retake
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
