"use client";

import { createContext, useContext } from "react";

import { VOCAB, type Vocab } from "@/lib/vocabulary";

const VocabContext = createContext<Vocab>(VOCAB.clinic);

export function VocabProvider({
  value,
  children,
}: {
  value: Vocab;
  children: React.ReactNode;
}) {
  return <VocabContext.Provider value={value}>{children}</VocabContext.Provider>;
}

/** Vocabulary for the active venue type. Defaults to clinic terms. */
export function useVocab(): Vocab {
  return useContext(VocabContext);
}
