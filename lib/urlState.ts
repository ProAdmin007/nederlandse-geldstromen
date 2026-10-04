"use client";

import { useEffect, useRef, useState } from "react";
import type { CategoryFilter, SectorFilter, Unit } from "./calc";
import type { Lang } from "./types";

export interface ViewState {
  year: number;
  sector: SectorFilter;
  category: CategoryFilter;
  unit: Unit;
  reexport: boolean;
  estimates: boolean;
  ultimate: boolean;
  table: boolean;
  country: string | null;
  /** Vergelijkingsjaar, of null. */
  compare: number | null;
  lang: Lang;
  /** Actief verhaal (id uit lib/stories.ts), of null. */
  story: string | null;
}

const SECTORS: SectorFilter[] = ["alles", "overheid", "bedrijven", "consumenten"];
const CATS: CategoryFilter[] = ["alles", "it", "energie", "goederen", "diensten", "defensie", "ie", "hulp", "eu", "uitkeringen", "overmakingen"];
const UNITS: Unit[] = ["eur", "pp", "bbp"];

/** Leest de stand uit de URL, zodat een gedeelde link precies hetzelfde beeld geeft. */
export function parse(search: string, fallback: ViewState, years: number[]): ViewState {
  const q = new URLSearchParams(search);
  const year = Number(q.get("jaar"));
  const pick = <T extends string>(v: string | null, allowed: T[], d: T) => (allowed.includes(v as T) ? (v as T) : d);
  return {
    year: years.includes(year) ? year : fallback.year,
    sector: pick(q.get("sector"), SECTORS, fallback.sector),
    category: pick(q.get("categorie"), CATS, fallback.category),
    unit: pick(q.get("eenheid"), UNITS, fallback.unit),
    reexport: q.get("wederuitvoer") !== "nee",
    estimates: q.get("schattingen") !== "nee",
    ultimate: q.get("ontvanger") === "uiteindelijk",
    table: q.get("weergave") === "tabel",
    country: q.get("land") || null,
    compare: years.includes(Number(q.get("vergelijk"))) ? Number(q.get("vergelijk")) : null,
    lang: q.get("lang") === "en" ? "en" : q.get("lang") === "nl" ? "nl" : fallback.lang,
    story: q.get("verhaal") || null,
  };
}

/** Schrijft alleen afwijkingen van de standaard weg, zodat links kort blijven. */
export function serialize(s: ViewState, fallback: ViewState): string {
  const q = new URLSearchParams();
  if (s.year !== fallback.year) q.set("jaar", String(s.year));
  if (s.sector !== "alles") q.set("sector", s.sector);
  if (s.category !== "alles") q.set("categorie", s.category);
  if (s.unit !== "eur") q.set("eenheid", s.unit);
  if (!s.reexport) q.set("wederuitvoer", "nee");
  if (!s.estimates) q.set("schattingen", "nee");
  if (s.ultimate) q.set("ontvanger", "uiteindelijk");
  if (s.table) q.set("weergave", "tabel");
  if (s.country) q.set("land", s.country);
  if (s.compare != null) q.set("vergelijk", String(s.compare));
  if (s.lang !== "nl") q.set("lang", s.lang);
  if (s.story) q.set("verhaal", s.story);
  const str = q.toString();
  return str ? `?${str}` : "";
}

export function useUrlState(fallback: ViewState | null, years: number[]) {
  const [state, setState] = useState<ViewState | null>(null);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  useEffect(() => {
    if (!fallback || state) return;
    setState(parse(window.location.search, fallback, years));
  }, [fallback, state, years]);

  useEffect(() => {
    if (!state || !fallbackRef.current) return;
    const url = `${window.location.pathname}${serialize(state, fallbackRef.current)}`;
    window.history.replaceState(null, "", url);
  }, [state]);

  const update = (patch: Partial<ViewState>) => setState((s) => (s ? { ...s, ...patch } : s));
  return [state, update] as const;
}
