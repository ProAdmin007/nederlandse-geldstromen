"use client";

import { useMemo, useState } from "react";
import type { Country, DataType, Dataset, Flow, Lang } from "@/lib/types";
import {
  formatChange,
  ranked,
  recipientsFor,
  sumDataType,
  totals,
  totalsBy,
  trend,
  type Options,
  type Totals,
} from "@/lib/calc";
import { CATEGORIES } from "@/lib/data";
import { CATEGORY_LABELS, DATATYPE_LABELS, SECTOR_LABELS, type Strings } from "@/lib/i18n";
import TrendChart from "./TrendChart";

export type Fmt = (amountMln: number, signed?: boolean, year?: number) => string;

export interface Ctx {
  data: Dataset;
  opts: Options;
  resolved: Map<string, Flow[]>;
  /** Weergaveregels voor het vergelijkingsjaar. */
  compare: { year: number; resolved: Map<string, Flow[]> } | null;
  fmt: Fmt;
  lang: Lang;
  t: Strings;
  onYear: (year: number) => void;
}

export function Badge({ type, lang }: { type: DataType; lang: Lang }) {
  return <span className={`badge badge--${type}`}>{DATATYPE_LABELS[lang][type]}</span>;
}

function SourceRef({ ctx, id, year }: { ctx: Ctx; id: string; year: number | string }) {
  const s = ctx.data.sources[id];
  if (!s) return <span className="src">{ctx.t.unknownSource} · {year}</span>;
  const label = `${s.publisher} – ${s.name}`;
  return (
    <span className="src">
      {s.url ? (
        <a href={s.url} target="_blank" rel="noreferrer">
          {label}
        </a>
      ) : (
        label
      )}{" "}
      · {year}
    </span>
  );
}

/** "2019: €12 mld · +8%" onder een bedrag, als er vergeleken wordt. */
function Delta({ ctx, from, to, signed }: { ctx: Ctx; from: number | undefined; to: number; signed?: boolean }) {
  if (!ctx.compare || from == null) return null;
  // Bij een saldo dat van teken kan wisselen zegt een percentage niets.
  const change = signed ? "" : formatChange(from, to, ctx.lang);
  const up = to > from;
  return (
    <div className="delta">
      {ctx.compare.year}: {ctx.fmt(from, signed, ctx.compare.year)}
      {change && <span className={up ? "delta__up" : "delta__down"}> · {change}</span>}
    </div>
  );
}

function Stat(props: { label: string; value: number; flows: Flow[]; tone: string; ctx: Ctx; from?: number; signed?: boolean }) {
  const { label, value, flows, tone, ctx, from, signed } = props;
  return (
    <div className={`stat stat--${tone}`}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{ctx.fmt(value, signed)}</div>
      <Delta ctx={ctx} from={from} to={value} signed={signed} />
      {flows.length > 0 && (
        <div className="stat__meta">
          <Badge type={sumDataType(flows)} lang={ctx.lang} />
          <span>
            {ctx.t.sumOf(flows.length)} · {ctx.opts.year}
          </span>
        </div>
      )}
    </div>
  );
}

function Stats({ flows, prev, name, ctx }: { flows: Flow[]; prev?: Totals; name?: string; ctx: Ctx }) {
  const t = totals(flows);
  return (
    <div className="stats">
      <Stat label={name ? ctx.t.nlTo(name) : ctx.t.outOfNl} value={t.uit} from={prev?.uit} flows={flows.filter((f) => f.direction === "uit")} tone="uit" ctx={ctx} />
      <Stat label={name ? ctx.t.toNl(name) : ctx.t.intoNl} value={t.in} from={prev?.in} flows={flows.filter((f) => f.direction === "in")} tone="in" ctx={ctx} />
      <Stat
        label={t.netto >= 0 ? ctx.t.netIn : ctx.t.netOut}
        value={t.netto}
        from={prev?.netto}
        signed
        flows={flows}
        tone={t.netto >= 0 ? "in" : "uit"}
        ctx={ctx}
      />
    </div>
  );
}

/** Eerlijke uitleg bij filters waar de data dun, afgeleid of niet vergelijkbaar is. */
function FilterNotes({ ctx }: { ctx: Ctx }) {
  const { opts, data, t } = ctx;
  const notes: string[] = [];
  const servicesFrom = Math.min(...data.meta.serviceYears);
  if (opts.year < servicesFrom) notes.push(t.noteNoServices(servicesFrom));
  const breaks = data.meta.breaks.filter((b) => b.year === opts.year || (ctx.compare && ((ctx.compare.year < b.year && b.year <= opts.year) || (opts.year < b.year && b.year <= ctx.compare.year))));
  if (breaks.length) notes.push(t.noteBreak(breaks.map((b) => `${b.year}: ${b.label}`).join("; ")));
  else {
    const later = data.meta.breaks.filter((b) => b.year > opts.year);
    if (later.length) notes.push(t.noteOldMethod(later.map((b) => `${b.year}: ${b.label}`).join("; ")));
  }
  if (opts.sector === "consumenten") notes.push(t.noteConsumers);
  if (opts.sector === "overheid") notes.push(t.noteGovernment);
  if (opts.sector === "bedrijven") notes.push(t.noteBusiness);
  if (!opts.reexport) notes.push(t.noteNoReexport);
  if (opts.ultimate) notes.push(t.noteUltimate);
  if (opts.category === "defensie") notes.push(t.noteDefense);
  if (opts.category === "it" || opts.category === "ie") notes.push(t.noteIntraGroup);
  if (!notes.length) return null;
  return (
    <ul className="filter-notes">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

function Recipients({ ctx, countryId, title }: { ctx: Ctx; countryId?: string; title: string }) {
  const list = recipientsFor(ctx.data, ctx.opts, countryId);
  if (!list.length) return null;
  return (
    <>
      <h3>{title}</h3>
      <p className="muted small">{ctx.t.recipientsIntro}</p>
      <ul className="rows">
        {list.map((r) => (
          <li key={`${r.name}-${r.year}`} className="row">
            <div className="row__main">
              <strong>{r.name}</strong>
              <span className="muted">
                {" "}
                · {CATEGORY_LABELS[ctx.lang][r.category]} · {SECTOR_LABELS[ctx.lang][r.sector]}
              </span>
              {r.note && <div className="muted small">{r.note}</div>}
              <SourceRef ctx={ctx} id={r.source} year={r.year} />
            </div>
            <div className="row__side">
              <span className="amount">{ctx.fmt(r.amount, false, r.year)}</span>
              <Badge type={r.dataType} lang={ctx.lang} />
              {r.stale && <span className="muted small">{ctx.t.figureFrom(r.year)}</span>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function CategoryBars({ flows, ctx }: { flows: Flow[]; ctx: Ctx }) {
  const byCat = totalsBy(flows, CATEGORIES, (f) => f.category);
  const cats = CATEGORIES.filter((c) => byCat[c].uit > 0 || byCat[c].in > 0);
  const max = Math.max(1e-9, ...cats.flatMap((c) => [byCat[c].uit, byCat[c].in]));
  if (!cats.length) return null;
  return (
    <>
      <h3>{ctx.t.byCategory}</h3>
      <div className="cats">
        {cats.map((c) => (
          <div className="cat" key={c}>
            <div className="cat__name">{CATEGORY_LABELS[ctx.lang][c]}</div>
            <div className="cat__bars">
              {(["uit", "in"] as const).map((d) => (
                <div className="bar" key={d}>
                  <span className={`bar__fill bar__fill--${d}`} style={{ width: `calc((100% - 90px) * ${byCat[c][d] / max})` }} />
                  <span className="bar__val">{byCat[c][d] > 0 ? ctx.fmt(byCat[c][d]) : "–"}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function useTrend(ctx: Ctx, countryId?: string) {
  const { year: _y, ...rest } = ctx.opts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => trend(ctx.data, rest, countryId), [ctx.data, countryId, JSON.stringify(rest)]);
}

/** CBS-reeksen met methodewissels; andere bronnen (hulp, EU, ...) hebben die breuken niet. */
const CBS_CATEGORIES = ["alles", "goederen", "energie", "diensten", "it", "ie", "defensie"];
const SERVICE_CATEGORIES = ["alles", "diensten", "it", "ie"];

function Trend({ ctx, countryId }: { ctx: Ctx; countryId?: string }) {
  const points = useTrend(ctx, countryId);
  const cat = ctx.opts.category;
  return (
    <>
      <h3>{ctx.t.trend}</h3>
      <TrendChart
        points={points}
        year={ctx.opts.year}
        compareYear={ctx.compare?.year ?? null}
        serviceYears={SERVICE_CATEGORIES.includes(cat) ? ctx.data.meta.serviceYears : ctx.data.meta.years}
        breaks={CBS_CATEGORIES.includes(cat) ? ctx.data.meta.breaks : []}
        onYear={ctx.onYear}
        fmt={ctx.fmt}
        t={ctx.t}
      />
    </>
  );
}

export function CountryDetail({ country, ctx, onClose }: { country: Country; ctx: Ctx; onClose: () => void }) {
  const flows = ctx.resolved.get(country.id) ?? [];
  const prev = ctx.compare ? totals(ctx.compare.resolved.get(country.id) ?? []) : undefined;
  const sorted = [...flows].sort((a, b) => b.amount - a.amount);
  const L = ctx.lang;

  return (
    <div className="detail">
      <div className="detail__head">
        <div>
          <h2>{country.name}</h2>
          <p className="muted">
            {ctx.opts.year}
            {ctx.compare ? ` ${ctx.t.vs} ${ctx.compare.year}` : ""} · {SECTOR_LABELS[L][ctx.opts.sector]} · {CATEGORY_LABELS[L][ctx.opts.category]}
          </p>
        </div>
        <button className="close" onClick={onClose} aria-label={ctx.t.close}>
          ×
        </button>
      </div>

      <Stats flows={flows} prev={prev} name={country.name} ctx={ctx} />
      <FilterNotes ctx={ctx} />
      <Trend ctx={ctx} countryId={country.id} />

      {flows.length === 0 ? <p className="muted">{ctx.t.noFlows}</p> : <CategoryBars flows={flows} ctx={ctx} />}

      <Recipients ctx={ctx} countryId={country.id} title={ctx.t.recipients} />
      {["alles", "it", "ie", "diensten"].includes(ctx.opts.category) && <TaxSection ctx={ctx} countryId={country.id} />}

      {sorted.length > 0 && (
        <>
          <h3>{ctx.t.allAmounts}</h3>
          <ul className="rows">
            {sorted.map((f, i) => (
              <li key={i} className="row">
                <div className="row__main">
                  <span className={`dir dir--${f.direction}`}>{f.direction === "uit" ? ctx.t.nlTo(country.name) : ctx.t.toNl(country.name)}</span>
                  <div>
                    <strong>{CATEGORY_LABELS[L][f.category]}</strong>
                    <span className="muted"> · {SECTOR_LABELS[L][f.sector]}</span>
                  </div>
                  {f.movedFrom && <div className="small moved">{ctx.t.movedFrom(f.movedFrom)}</div>}
                  {f.note && <div className="muted small">{f.note}</div>}
                  {f.adjustments?.map((a) => (
                    <div key={a.label} className="muted small">
                      {ctx.t.subtracted}: {a.label} ({ctx.fmt(a.amount)}, {DATATYPE_LABELS[L][a.dataType].toLowerCase()})
                    </div>
                  ))}
                  <SourceRef ctx={ctx} id={f.source} year={f.year} />
                </div>
                <div className="row__side">
                  <span className="amount">{ctx.fmt(f.amount)}</span>
                  <Badge type={f.dataType} lang={L} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const COUNTRY_SHORT: Record<string, Record<Lang, string>> = {
  "528": { nl: "Nederland", en: "Netherlands" },
  "372": { nl: "Ierland", en: "Ireland" },
  "442": { nl: "Luxemburg", en: "Luxembourg" },
  "840": { nl: "VS", en: "US" },
};

/** Omzet, winst en belasting per concern en land (uit landenrapporten). */
export function TaxSection({ ctx, countryId }: { ctx: Ctx; countryId?: string }) {
  const { t, lang } = ctx;
  const rows = ctx.data.taxes.filter((r) => !countryId || r.parent === countryId || r.country === countryId);
  if (!rows.length) return null;
  const nf = new Intl.NumberFormat(lang === "en" ? "en-GB" : "nl-NL", { maximumFractionDigits: 0 });
  const money = (v: number | undefined, cur: string) => {
    if (v == null) return "–";
    const sym = cur === "USD" ? "$" : "€";
    return Math.abs(v) >= 1000
      ? `${sym}${new Intl.NumberFormat(lang === "en" ? "en-GB" : "nl-NL", { maximumFractionDigits: 1 }).format(v / 1000)} ${lang === "en" ? "bn" : "mld"}`
      : `${sym}${nf.format(v)} ${lang === "en" ? "m" : "mln"}`;
  };
  const companies = [...new Set(rows.map((r) => r.company))];
  return (
    <>
      <h3>{t.taxTitle}</h3>
      <p className="muted small">{t.taxIntro}</p>
      {companies.map((company) => {
        const list = rows
          .filter((r) => r.company === company)
          .sort((a, b) => (a.country === "528" ? -1 : b.country === "528" ? 1 : 0) || b.year - a.year);
        return (
          <div key={company} className="tax">
            <strong>{company}</strong>
            <table className="tax__table">
              <thead>
                <tr>
                  <th />
                  <th className="num">{t.taxRevenue}</th>
                  <th className="num">{t.taxProfit}</th>
                  <th className="num">{t.taxPaid}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => {
                  const tax = r.taxPaid ?? r.taxAccrued;
                  const rate = tax != null && r.profit ? Math.round((tax / r.profit) * 100) : null;
                  return (
                    <tr key={i} className={r.country === "528" ? "is-nl" : undefined}>
                      <th scope="row">
                        {COUNTRY_SHORT[r.country]?.[lang] ?? r.country} <span className="muted small">{r.period ?? r.year}</span>
                      </th>
                      <td className="num">{money(r.revenue, r.currency)}</td>
                      <td className="num">{money(r.profit, r.currency)}</td>
                      <td className="num">
                        {money(tax, r.currency)}
                        {rate != null && <div className="muted small">{rate}% {t.taxRate}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {list.map((r, i) => (
              <div key={i} className="small">
                {r.note && <div className="muted">{r.note}</div>}
                <SourceRef ctx={ctx} id={r.source} year={r.period ?? r.year} />
              </div>
            ))}
          </div>
        );
      })}
      {ctx.data.taxContext.length > 0 && (
        <>
          <h3>{t.taxContextTitle}</h3>
          <ul className="rows">
            {ctx.data.taxContext.map((c) => (
              <li key={c.text} className="row">
                <div className="row__main small">
                  {c.text}
                  <SourceRef ctx={ctx} id={c.source} year="" />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

const SHOW = 15;

export function Overview({ ctx, onSelect }: { ctx: Ctx; onSelect: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const rows = ranked(ctx.data, ctx.resolved);
  const flows = [...ctx.resolved.values()].flat();
  const prevAll = ctx.compare ? totals([...ctx.compare.resolved.values()].flat()) : undefined;
  const max = Math.max(1e-9, ...rows.flatMap((r) => [r.t.uit, r.t.in]));
  const cat = ctx.opts.category;
  const L = ctx.lang;

  return (
    <div className="detail">
      <h2>{cat === "alles" ? ctx.t.overview : CATEGORY_LABELS[L][cat]}</h2>
      <p className="muted">
        {ctx.opts.year}
        {ctx.compare ? ` ${ctx.t.vs} ${ctx.compare.year}` : ""} · {SECTOR_LABELS[L][ctx.opts.sector]} · {ctx.t.clickHint}
      </p>
      <Stats flows={flows} prev={prevAll} ctx={ctx} />
      <FilterNotes ctx={ctx} />
      <Trend ctx={ctx} />

      {cat === "alles" && <CategoryBars flows={flows} ctx={ctx} />}

      <h3>{cat === "alles" ? ctx.t.countries : ctx.t.whereTo(CATEGORY_LABELS[L][cat].toLowerCase())}</h3>
      <ul className="ranking">
        {(all ? rows : rows.slice(0, SHOW)).map(({ country, t }) => {
          const p = ctx.compare ? totals(ctx.compare.resolved.get(country.id) ?? []) : null;
          const ch = p ? formatChange(p.uit + p.in, t.uit + t.in, L) : "";
          return (
            <li key={country.id}>
              <button onClick={() => onSelect(country.id)}>
                <span className="ranking__name">
                  {country.name}
                  {ch && <span className={p && t.uit + t.in >= p.uit + p.in ? "delta__up" : "delta__down"}> {ch}</span>}
                </span>
                <span className="ranking__bars">
                  <span className="mini mini--uit" style={{ width: `${(t.uit / max) * 100}%` }} />
                  <span className="mini mini--in" style={{ width: `${(t.in / max) * 100}%` }} />
                </span>
                <span className="ranking__nums">
                  <span className="tone-uit">{ctx.fmt(t.uit)}</span>
                  <span className="tone-in">{ctx.fmt(t.in)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length > SHOW && (
        <button className="link-button" onClick={() => setAll((a) => !a)}>
          {all ? ctx.t.showLess : ctx.t.showAll(rows.length)}
        </button>
      )}

      <Recipients ctx={ctx} title={cat === "alles" ? ctx.t.recipients : ctx.t.recipientsCat} />
      {(cat === "it" || cat === "ie") && <TaxSection ctx={ctx} />}
      <p className="muted small">
        {ctx.t.yearsWithData}: {ctx.data.meta.years[0]}–{ctx.data.meta.years[ctx.data.meta.years.length - 1]}.
      </p>
    </div>
  );
}
