"use client";

import { useEffect, useMemo, useState } from "react";
import { expandDataset, type RawDataset } from "./dataset";
import type { Category, Dataset, Lang } from "./types";

/** Volgorde waarin categorieën in filters en grafieken staan. */
export const CATEGORIES: Category[] = [
  "goederen",
  "energie",
  "diensten",
  "it",
  "ie",
  "defensie",
  "hulp",
  "eu",
  "uitkeringen",
  "overmakingen",
];

const DATA_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/data/geldstromen.json`;

/** Laadt public/data/geldstromen.json (gegenereerd door npm run data:build) in de gekozen taal. */
export function useDataset(lang: Lang): { data: Dataset | null; error: string | null } {
  const [raw, setRaw] = useState<RawDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(DATA_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<RawDataset>;
      })
      .then(setRaw)
      .catch((e: Error) => setError(e.message));
  }, []);
  const data = useMemo(() => (raw ? expandDataset(raw, lang) : null), [raw, lang]);
  return { data, error };
}
