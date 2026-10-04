// Pure rekenfuncties: geen React, geen fetch. Getest in lib/calc.test.ts.
import type { Adjustment, Category, Country, DataType, Dataset, Flow, Recipient, Sector } from "./types";

export type SectorFilter = "alles" | Sector;
export type CategoryFilter = "alles" | Category;
export type Unit = "eur" | "pp" | "bbp";

export interface Options {
  year: number;
  sector: SectorFilter;
  category: CategoryFilter;
  /** true = inclusief wederuitvoer (zoals CBS publiceert). */
  reexport: boolean;
  /** true = schattingen tonen (en van officiële cijfers aftrekken waar ze daarin zitten). */
  estimates: boolean;
  /** true = toerekenen aan het land van de uiteindelijke ontvanger in plaats van het factuurland. */
  ultimate: boolean;
}

export const DEFAULT_OPTIONS: Omit<Options, "year"> = {
  sector: "alles",
  category: "alles",
  reexport: true,
  estimates: true,
  ultimate: false,
};

export interface Totals {
  uit: number;
  in: number;
  netto: number; // positief = netto geld naar Nederland
}

const RANK: Record<DataType, number> = { officieel: 0, berekend: 1, schatting: 2 };

/** De zwakste van twee kwaliteiten. */
export function weaker(a: DataType, b: DataType): DataType {
  return RANK[a] >= RANK[b] ? a : b;
}

/** Kwaliteit van een som: één schatting maakt het geheel een schatting; anders berekend. */
export function sumDataType(flows: Flow[]): DataType {
  if (flows.some((f) => f.dataType === "schatting")) return "schatting";
  if (flows.length === 1) return flows[0].dataType;
  return "berekend";
}

/**
 * Zet de ruwe regels van één land en jaar om in weergaveregels:
 * - wederuitvoer zit al in het CBS-cijfer; zonder wederuitvoer wordt het eraf getrokken;
 * - schattingen die in een officieel cijfer zitten (partOf) worden eraf getrokken en apart getoond,
 *   of helemaal weggelaten als schattingen uit staan.
 */
export function resolveYear(flows: Flow[], opts: Pick<Options, "year" | "reexport" | "estimates">): Flow[] {
  const rows = flows.filter((f) => f.year === opts.year);
  const out: Flow[] = rows.filter((f) => !f.partOf).map((f) => ({ ...f }));
  const parentOf = (sub: Flow) =>
    out.find(
      (p) => p.direction === sub.direction && p.category === sub.partOf && p.sector === "bedrijven" && !p.movedFrom,
    );

  const subtract = (parent: Flow | undefined, amount: number, adj: Adjustment) => {
    if (!parent) return;
    const take = Math.min(amount, parent.amount);
    parent.amount -= take;
    parent.dataType = weaker(parent.dataType === "officieel" ? "berekend" : parent.dataType, "berekend");
    parent.adjustments = [...(parent.adjustments ?? []), { ...adj, amount: take }];
  };

  for (const sub of rows.filter((f) => f.partOf)) {
    if (sub.reexport) {
      if (!opts.reexport) subtract(parentOf(sub), sub.amount, { label: "wederuitvoer", amount: sub.amount, dataType: sub.dataType });
      continue; // inclusief wederuitvoer: zit al in het cijfer
    }
    if (sub.dataType === "schatting" && !opts.estimates) continue;
    subtract(parentOf(sub), sub.amount, { label: sub.note ?? sub.category, amount: sub.amount, dataType: sub.dataType });
    const { partOf: _p, ...shown } = sub;
    out.push(shown);
  }

  return out.filter((f) => (opts.estimates || f.dataType !== "schatting") && f.amount > 0);
}

/**
 * Weergaveregels voor alle landen. Bij `ultimate` wordt een deel van een stroom verplaatst naar
 * het land van de uiteindelijke ontvanger (bv. Ierland → VS voor Amerikaanse techbedrijven).
 */
export function resolveAll(data: Dataset, opts: Options): Map<string, Flow[]> {
  const result = new Map<string, Flow[]>();
  for (const c of data.countries) result.set(c.id, resolveYear(c.flows, opts));

  if (opts.ultimate) {
    const names = new Map(data.countries.map((c) => [c.id, c.name]));
    for (const c of data.countries) {
      for (const f of result.get(c.id)!) {
        const v = f.via;
        if (!v || (v.dataType === "schatting" && !opts.estimates) || !result.has(v.country)) continue;
        const moved = f.amount * v.share;
        f.amount -= moved;
        f.adjustments = [
          ...(f.adjustments ?? []),
          { label: `toegerekend aan ${names.get(v.country)}`, amount: moved, dataType: v.dataType },
        ];
        result.get(v.country)!.push({
          ...f,
          amount: moved,
          dataType: weaker(f.dataType, v.dataType),
          source: v.source,
          note: v.note ?? `Gefactureerd vanuit ${c.name}`,
          movedFrom: c.name,
          adjustments: undefined,
          via: undefined,
        });
      }
    }
  }

  for (const [id, flows] of result) result.set(id, filterFlows(flows, opts));
  return result;
}

export function filterFlows(flows: Flow[], opts: Pick<Options, "sector" | "category">): Flow[] {
  return flows.filter(
    (f) =>
      (opts.sector === "alles" || f.sector === opts.sector) &&
      (opts.category === "alles" || f.category === opts.category) &&
      f.amount > 0,
  );
}

export function totals(flows: Flow[]): Totals {
  let uit = 0;
  let inn = 0;
  for (const f of flows) {
    if (f.direction === "uit") uit += f.amount;
    else inn += f.amount;
  }
  return { uit, in: inn, netto: inn - uit };
}

export function totalsBy<K extends string>(flows: Flow[], keys: readonly K[], key: (f: Flow) => K): Record<K, Totals> {
  const out = {} as Record<K, Totals>;
  for (const k of keys) out[k] = totals(flows.filter((f) => key(f) === k));
  return out;
}

/** Totalen per jaar voor één land (of alle landen), voor de trendgrafiek. */
export function trend(data: Dataset, opts: Omit<Options, "year">, countryId?: string): { year: number; t: Totals }[] {
  return data.meta.years.map((year) => {
    const all = resolveAll(data, { ...opts, year });
    const flows = countryId ? all.get(countryId) ?? [] : [...all.values()].flat();
    return { year, t: totals(flows) };
  });
}

/**
 * Ontvangers voor het gekozen jaar: per naam het meest recente cijfer tot en met dat jaar.
 * Bij `ultimate` horen ze bij het land van het moederbedrijf, anders bij het factuurland.
 */
export function recipientsFor(
  data: Dataset,
  opts: Options,
  countryId?: string,
): (Recipient & { stale: boolean })[] {
  const latest = new Map<string, Recipient>();
  for (const r of data.recipients) {
    if (r.year > opts.year) continue;
    if (r.dataType === "schatting" && !opts.estimates) continue;
    if (opts.sector !== "alles" && r.sector !== opts.sector) continue;
    if (opts.category !== "alles" && r.category !== opts.category) continue;
    const where = opts.ultimate ? r.country : r.billedFrom ?? r.country;
    if (countryId && where !== countryId) continue;
    const key = `${r.name}|${r.category}|${r.sector}`;
    const prev = latest.get(key);
    if (!prev || r.year > prev.year) latest.set(key, r);
  }
  return [...latest.values()]
    .map((r) => ({ ...r, stale: r.year !== opts.year }))
    .sort((a, b) => b.amount - a.amount);
}

// ---- Eenheden ---------------------------------------------------------------

/** Dichtstbijzijnde beschikbare waarde voor een jaar (bevolking en bbp lopen niet altijd even ver). */
function nearest(table: Record<string, number>, year: number): number | undefined {
  if (table[year] != null) return table[year];
  const ys = Object.keys(table).map(Number).sort((a, b) => Math.abs(a - year) - Math.abs(b - year));
  return ys.length ? table[ys[0]] : undefined;
}

/** Zet een bedrag (mln euro) om naar de gekozen eenheid. */
export function convert(amountMln: number, unit: Unit, year: number, meta: Dataset["meta"]): number {
  if (unit === "pp") {
    const pop = nearest(meta.population, year);
    return pop ? (amountMln * 1e6) / pop : NaN;
  }
  if (unit === "bbp") {
    const gdp = nearest(meta.gdp, year);
    return gdp ? (amountMln / gdp) * 100 : NaN;
  }
  return amountMln;
}

const nf1 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Formatteert een al omgerekende waarde. */
export function formatValue(value: number, unit: Unit, signed = false): string {
  if (!isFinite(value)) return "–";
  const sign = signed && value > 0.0001 ? "+" : value < -0.0001 ? "−" : "";
  const v = Math.abs(value);
  if (unit === "pp") return `${sign}€${nf0.format(v)} p.p.`;
  if (unit === "bbp") return `${sign}${v < 0.1 ? nf2.format(v) : nf1.format(v)}% bbp`;
  if (v >= 1000) return `${sign}€${nf1.format(v / 1000)} mld`;
  return `${sign}€${nf0.format(v)} mln`;
}

export function format(amountMln: number, unit: Unit, year: number, meta: Dataset["meta"], signed = false): string {
  return formatValue(convert(amountMln, unit, year, meta), unit, signed);
}

export function yearsOf(items: { year: number }[]): string {
  const ys = [...new Set(items.map((i) => i.year))].sort();
  if (ys.length === 0) return "–";
  return ys.length === 1 ? String(ys[0]) : `${ys[0]}–${ys[ys.length - 1]}`;
}

/** Landen in volgorde van totale omvang (uit + in) voor de gekozen opties. */
export function ranked(data: Dataset, resolved: Map<string, Flow[]>): { country: Country; t: Totals }[] {
  return data.countries
    .map((country) => ({ country, t: totals(resolved.get(country.id) ?? []) }))
    .filter((r) => r.t.uit > 0 || r.t.in > 0)
    .sort((a, b) => b.t.uit + b.t.in - (a.t.uit + a.t.in));
}

// ---- CSV ----------------------------------------------------------------------

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV (puntkomma, Nederlandse Excel-instelling) van alle weergaveregels. */
export function toCsv(data: Dataset, resolved: Map<string, Flow[]>, opts: Options): string {
  const header = [
    "jaar",
    "land",
    "iso_numeriek",
    "richting",
    "sector",
    "categorie",
    "bedrag_mln_eur",
    "datatype",
    "bron",
    "bron_url",
    "toelichting",
    "verplaatst_van",
    "aftrekposten",
  ];
  const lines = [header.join(";")];
  for (const c of data.countries) {
    for (const f of resolved.get(c.id) ?? []) {
      const src = data.sources[f.source];
      lines.push(
        [
          opts.year,
          c.name,
          c.id,
          f.direction === "uit" ? "NL naar land" : "land naar NL",
          f.sector,
          f.category,
          f.amount.toFixed(1).replace(".", ","),
          f.dataType,
          src ? `${src.publisher} – ${src.name}` : f.source,
          src?.url ?? "",
          f.note ?? "",
          f.movedFrom ?? "",
          (f.adjustments ?? []).map((a) => `${a.label}: ${a.amount.toFixed(1).replace(".", ",")}`).join(" | "),
        ]
          .map(csvCell)
          .join(";"),
      );
    }
  }
  return lines.join("\n");
}
