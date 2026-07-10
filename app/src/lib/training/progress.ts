"use client";

import { useEffect, useState, useCallback } from "react";

const KEY = "renova.training.progress.v1";

export interface Progress {
  modules: Record<string, { read: boolean; quizScore: number | null; quizMax: number | null }>;
  flashcards: Record<string, boolean>;
  roleplays: Record<string, "success" | "partial" | "fail" | null>;
}

function empty(): Progress {
  return { modules: {}, flashcards: {}, roleplays: {} };
}

function readProgress(): Progress {
  if (typeof window === "undefined") return empty();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Progress;
    return { ...empty(), ...parsed, modules: parsed.modules ?? {}, flashcards: parsed.flashcards ?? {}, roleplays: parsed.roleplays ?? {} };
  } catch {
    return empty();
  }
}

function writeProgress(p: Progress) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(p));
  window.dispatchEvent(new Event("renova.training.progress"));
}

export function useProgress() {
  const [progress, setProgress] = useState<Progress>(empty);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setProgress(readProgress());
    setHydrated(true);
    const onUpdate = () => setProgress(readProgress());
    window.addEventListener("renova.training.progress", onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      window.removeEventListener("renova.training.progress", onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  }, []);

  const markModuleRead = useCallback((slug: string) => {
    const next = readProgress();
    next.modules[slug] = { ...(next.modules[slug] ?? { read: false, quizScore: null, quizMax: null }), read: true };
    writeProgress(next);
  }, []);

  const recordQuiz = useCallback((slug: string, score: number, max: number) => {
    const next = readProgress();
    const existing = next.modules[slug] ?? { read: false, quizScore: null, quizMax: null };
    const bestScore = existing.quizScore == null ? score : Math.max(existing.quizScore, score);
    next.modules[slug] = { read: true, quizScore: bestScore, quizMax: max };
    writeProgress(next);
  }, []);

  const toggleFlashcard = useCallback((id: string, mastered: boolean) => {
    const next = readProgress();
    if (mastered) next.flashcards[id] = true;
    else delete next.flashcards[id];
    writeProgress(next);
  }, []);

  const recordRoleplay = useCallback((id: string, result: "success" | "partial" | "fail") => {
    const next = readProgress();
    const prev = next.roleplays[id];
    const rank = { success: 3, partial: 2, fail: 1, null: 0 } as const;
    if (!prev || (rank[result] >= rank[prev as keyof typeof rank])) {
      next.roleplays[id] = result;
      writeProgress(next);
    }
  }, []);

  const reset = useCallback(() => {
    writeProgress(empty());
  }, []);

  return { progress, hydrated, markModuleRead, recordQuiz, toggleFlashcard, recordRoleplay, reset };
}
