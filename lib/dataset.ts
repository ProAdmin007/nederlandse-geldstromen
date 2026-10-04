import type { Category, Country, DataType, Dataset, Direction, Flow, Recipient, Sector, Source, Via } from "./types";

/** Compact formaat zoals scripts/build-data.mjs het wegschrijft. */
export interface RawDataset {
  format: 2;
  meta: Dataset["meta"];
  netherlands: Dataset["netherlands"];
  dict: {
    directions: Direction[];
    sectors: Sector[];
    categories: Category[];
    dataTypes: DataType[];
    sources: string[];
    notes: string[];
  };
  sources: Record<string, Source>;
  countries: {
    id: string;
    name: string;
    coords: [number, number];
    /** [jaar, richting, sector, categorie, bedrag, datatype, bron, toelichting, partOf, wederuitvoer] als indexen in `dict`. */
    rows: number[][];
    via?: (Via & { category: Category; direction: Direction })[];
  }[];
  recipients: Recipient[];
}

/** Pakt het compacte bestand uit naar het datamodel uit lib/types.ts. */
export function expandDataset(raw: RawDataset): Dataset {
  const d = raw.dict;
  const countries: Country[] = raw.countries.map((c) => ({
    id: c.id,
    name: c.name,
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
      if (note >= 0) f.note = d.notes[note];
      if (partOf >= 0) f.partOf = d.categories[partOf];
      if (reexport) f.reexport = true;
      const via = c.via?.find((v) => v.category === f.category && v.direction === f.direction);
      if (via && !f.partOf) {
        const { category: _c, direction: _d, ...rest } = via;
        f.via = rest;
      }
      return f;
    }),
  }));
  return {
    meta: raw.meta,
    netherlands: raw.netherlands,
    sources: raw.sources,
    countries,
    recipients: raw.recipients,
  };
}
