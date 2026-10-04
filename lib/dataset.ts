import type { Category, Country, DataType, Dataset, Direction, Flow, Lang, Recipient, Sector, Source, Via } from "./types";

type Text = { nl: string; en: string };

/** Compact formaat zoals scripts/build-data.mjs het wegschrijft. */
export interface RawDataset {
  format: 3;
  meta: Omit<Dataset["meta"], "notes" | "breaks"> & {
    notes: Text[];
    breaks: ({ year: number } & Text)[];
  };
  netherlands: Dataset["netherlands"];
  dict: {
    directions: Direction[];
    sectors: Sector[];
    categories: Category[];
    dataTypes: DataType[];
    sources: string[];
    notes: Text[];
  };
  sources: Record<string, Source>;
  countries: {
    id: string;
    name: string;
    nameEn: string;
    coords: [number, number];
    /** [jaar, richting, sector, categorie, bedrag, datatype, bron, toelichting, partOf, wederuitvoer] als indexen in `dict`. */
    rows: number[][];
    via?: (Omit<Via, "note"> & { category: Category; direction: Direction; note?: Text })[];
  }[];
  recipients: (Omit<Recipient, "note"> & { note?: Text })[];
}

/** Pakt het compacte bestand uit naar het datamodel uit lib/types.ts, in de gekozen taal. */
export function expandDataset(raw: RawDataset, lang: Lang = "nl"): Dataset {
  const d = raw.dict;
  const text = (t?: Text) => (t ? t[lang] : undefined);
  const countries: Country[] = raw.countries.map((c) => ({
    id: c.id,
    name: lang === "en" ? c.nameEn : c.name,
    altName: lang === "en" ? c.name : c.nameEn,
    coords: c.coords,
    flows: c.rows.map(([year, dir, sec, cat, amount, type, src, note, partOf, reexport]) => {
      const f: Flow = {
        year,
        direction: d.directions[dir],
        sector: d.sectors[sec],
        category: d.categories[cat],
        amount,
        dataType: d.dataTypes[type],
        source: d.sources[src],
      };
      if (note >= 0) f.note = d.notes[note][lang];
      if (partOf >= 0) f.partOf = d.categories[partOf];
      if (reexport) f.reexport = true;
      const via = c.via?.find((v) => v.category === f.category && v.direction === f.direction);
      if (via && !f.partOf) {
        const { category: _c, direction: _d, note: viaNote, ...rest } = via;
        f.via = { ...rest, note: text(viaNote) };
      }
      return f;
    }),
  }));
  const sources = Object.fromEntries(
    Object.entries(raw.sources).map(([k, s]) => [k, { ...s, name: lang === "en" && s.nameEn ? s.nameEn : s.name }]),
  );
  return {
    meta: {
      ...raw.meta,
      notes: raw.meta.notes.map((n) => n[lang]),
      breaks: raw.meta.breaks.map((b) => ({ year: b.year, label: b[lang] })),
    },
    netherlands: raw.netherlands,
    sources,
    countries,
    recipients: raw.recipients.map((r) => ({ ...r, name: lang === "en" && r.nameEn ? r.nameEn : r.name, note: text(r.note) })),
  };
}
