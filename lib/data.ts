"use client";

import { useEffect, useState } from "react";
import { expandDataset, type RawDataset } from "./dataset";
import type { Category, DataType, Dataset } from "./types";
import type { CategoryFilter, SectorFilter, Unit } from "./calc";

export const SECTOR_LABELS: Record<SectorFilter, string> = {
  alles: "Alles",
  overheid: "Overheid",
  bedrijven: "Bedrijven",
  consumenten: "Consumenten",
};

export const CATEGORIES: Category[] = ["goederen", "energie", "diensten", "it", "ie", "defensie"];

export const CATEGORY_LABELS: Record<CategoryFilter, string> = {
  alles: "Alle categorieën",
  it: "IT / software / cloud",
  energie: "Energie",
  goederen: "Goederen",
  diensten: "Diensten",
  defensie: "Defensie",
  ie: "Intellectueel eigendom",
};

export const DATATYPE_LABELS: Record<DataType, string> = {
  officieel: "Officieel",
  berekend: "Berekend",
  schatting: "Schatting",
};

export const UNIT_LABELS: Record<Unit, string> = {
  eur: "Euro",
  pp: "Per inwoner",
  bbp: "% bbp",
};

const DATA_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/data/geldstromen.json`;

/** Laadt public/data/geldstromen.json (gegenereerd door npm run data:build). */
export function useDataset(): { data: Dataset | null; error: string | null } {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(DATA_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<RawDataset>;
      })
      .then((raw) => setData(expandDataset(raw)))
      .catch((e: Error) => setError(e.message));
  }, []);
  return { data, error };
}
